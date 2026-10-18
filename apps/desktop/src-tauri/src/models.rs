//! Lectura de solo lectura del almacenamiento de Ollama y de la información del sistema.
//!
//! Nada de este módulo escribe, mueve ni borra archivos. La eliminación de modelos de Ollama se
//! hace exclusivamente con su API oficial (DELETE /api/delete) desde la interfaz.
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_MANIFESTS: usize = 4000;
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_BLOBS: usize = 100_000;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub digest: String,
    pub bytes: u64,
    pub shared: bool,
}
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredModel {
    pub name: String,
    pub layers: Vec<Layer>,
    pub exclusive_bytes: u64,
    pub shared_bytes: u64,
}
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStorage {
    /// Carpeta analizada.
    pub root: String,
    /// Suma del tamaño real de los archivos en blobs/ (lo que ocupa en disco).
    pub total_bytes: u64,
    pub models: Vec<StoredModel>,
}

/// Carpetas candidatas, en el orden que usa Ollama: variable OLLAMA_MODELS y luego las
/// ubicaciones por defecto del usuario y del servicio de Linux.
pub fn candidate_roots(env_models: Option<String>, home: Option<PathBuf>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(p) = env_models.filter(|p| !p.trim().is_empty()) {
        roots.push(PathBuf::from(p));
    }
    if let Some(h) = home {
        roots.push(h.join(".ollama").join("models"));
    }
    if cfg!(target_os = "linux") {
        roots.push(PathBuf::from("/usr/share/ollama/.ollama/models"));
        roots.push(PathBuf::from("/var/lib/ollama/.ollama/models"));
    }
    roots
}

fn is_plain_dir(p: &Path) -> bool {
    fs::symlink_metadata(p).map(|m| m.is_dir()).unwrap_or(false)
}

/// Recorre manifests/ sin seguir enlaces simbólicos y con límites de cantidad y tamaño.
fn manifest_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > 6 || out.len() >= MAX_MANIFESTS {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let Ok(meta) = fs::symlink_metadata(entry.path()) else { continue };
        if meta.is_dir() {
            manifest_files(&entry.path(), depth + 1, out);
        } else if meta.is_file() && meta.len() <= MAX_MANIFEST_BYTES {
            out.push(entry.path());
        }
        if out.len() >= MAX_MANIFESTS {
            return;
        }
    }
}

/// Nombre que muestra Ollama a partir de la ruta del manifiesto.
pub fn model_name(manifests: &Path, file: &Path) -> Option<String> {
    let rel: Vec<String> = file.strip_prefix(manifests).ok()?.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    if rel.len() < 4 {
        return None;
    }
    let (host, namespace, model, tag) = (&rel[0], &rel[1], &rel[2], &rel[3]);
    Some(if host == "registry.ollama.ai" && namespace == "library" {
        format!("{model}:{tag}")
    } else if host == "registry.ollama.ai" {
        format!("{namespace}/{model}:{tag}")
    } else {
        format!("{host}/{namespace}/{model}:{tag}")
    })
}

fn layers_of(file: &Path) -> Option<Vec<(String, u64)>> {
    let text = fs::read_to_string(file).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let mut out = Vec::new();
    let mut push = |v: &serde_json::Value| {
        if let (Some(d), Some(s)) = (v.get("digest").and_then(|d| d.as_str()), v.get("size").and_then(|s| s.as_u64())) {
            if d.starts_with("sha256:") && d.len() == 71 && d[7..].chars().all(|c| c.is_ascii_hexdigit()) {
                out.push((d.to_string(), s));
            }
        }
    };
    if let Some(c) = value.get("config") {
        push(c);
    }
    for l in value.get("layers").and_then(|l| l.as_array()).into_iter().flatten() {
        push(l);
    }
    Some(out)
}

/// Analiza una carpeta de modelos de Ollama. Solo lee metadatos y manifiestos.
pub fn scan(root: &Path) -> Result<OllamaStorage, String> {
    let manifests = root.join("manifests");
    let blobs = root.join("blobs");
    if !is_plain_dir(&manifests) || !is_plain_dir(&blobs) {
        return Err(format!("No se encontró una carpeta de modelos de Ollama en {}", root.display()));
    }
    let mut files = Vec::new();
    manifest_files(&manifests, 0, &mut files);
    let mut parsed: Vec<(String, Vec<(String, u64)>)> = Vec::new();
    let mut uses: HashMap<String, usize> = HashMap::new();
    for f in files {
        let (Some(name), Some(layers)) = (model_name(&manifests, &f), layers_of(&f)) else { continue };
        let mut seen = std::collections::HashSet::new();
        for (d, _) in &layers {
            if seen.insert(d.clone()) {
                *uses.entry(d.clone()).or_insert(0) += 1;
            }
        }
        parsed.push((name, layers));
    }
    let models = parsed
        .into_iter()
        .map(|(name, layers)| {
            let layers: Vec<Layer> = layers
                .into_iter()
                .map(|(digest, bytes)| {
                    let shared = uses.get(&digest).copied().unwrap_or(0) > 1;
                    Layer { digest, bytes, shared }
                })
                .collect();
            let exclusive_bytes = layers.iter().filter(|l| !l.shared).map(|l| l.bytes).sum();
            let shared_bytes = layers.iter().filter(|l| l.shared).map(|l| l.bytes).sum();
            StoredModel { name, layers, exclusive_bytes, shared_bytes }
        })
        .collect();
    let mut total_bytes = 0u64;
    if let Ok(entries) = fs::read_dir(&blobs) {
        for entry in entries.flatten().take(MAX_BLOBS) {
            if let Ok(meta) = fs::symlink_metadata(entry.path()) {
                if meta.is_file() {
                    total_bytes += meta.len();
                }
            }
        }
    }
    Ok(OllamaStorage { root: root.display().to_string(), total_bytes, models })
}

/// Primera carpeta candidata que contiene modelos de Ollama.
pub fn find_and_scan(roots: &[PathBuf]) -> Result<OllamaStorage, String> {
    let mut last = String::from("No se encontró la carpeta de modelos de Ollama.");
    for r in roots {
        match scan(r) {
            Ok(s) => return Ok(s),
            Err(e) => last = e,
        }
    }
    Err(last)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub total_memory_bytes: u64,
    pub available_memory_bytes: u64,
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub os: String,
}
pub fn system_info() -> SystemInfo {
    use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
    let sys = System::new_with_specifics(RefreshKind::nothing().with_memory(MemoryRefreshKind::everything()).with_cpu(CpuRefreshKind::nothing()));
    let brand = sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default();
    SystemInfo {
        total_memory_bytes: sys.total_memory(),
        available_memory_bytes: sys.available_memory(),
        cpu_brand: brand,
        cpu_cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(sys.cpus().len()),
        os: System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp() -> PathBuf {
        let p = std::env::temp_dir().join(format!("oratoria-ollama-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&p).unwrap();
        p
    }
    fn digest(c: char) -> String {
        format!("sha256:{}", c.to_string().repeat(64))
    }
    fn manifest(root: &Path, path: &str, layers: &[(char, u64)]) {
        let file = root.join("manifests").join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        let ls: Vec<String> = layers.iter().skip(1).map(|(c, s)| format!(r#"{{"digest":"{}","size":{s}}}"#, digest(*c))).collect();
        let (c0, s0) = layers[0];
        fs::write(&file, format!(r#"{{"schemaVersion":2,"config":{{"digest":"{}","size":{s0}}},"layers":[{}]}}"#, digest(c0), ls.join(","))).unwrap();
        fs::create_dir_all(root.join("blobs")).unwrap();
        for (c, s) in layers {
            let blob = root.join("blobs").join(format!("sha256-{}", c.to_string().repeat(64)));
            fs::write(blob, vec![0u8; *s as usize]).unwrap();
        }
    }
    #[test]
    fn names_follow_ollama_conventions() {
        let m = Path::new("/m/manifests");
        assert_eq!(model_name(m, Path::new("/m/manifests/registry.ollama.ai/library/qwen3.5/4b")), Some("qwen3.5:4b".into()));
        assert_eq!(model_name(m, Path::new("/m/manifests/registry.ollama.ai/user/model/latest")), Some("user/model:latest".into()));
        assert_eq!(model_name(m, Path::new("/m/manifests/hf.co/org/repo/q4")), Some("hf.co/org/repo:q4".into()));
        assert_eq!(model_name(m, Path::new("/m/manifests/short")), None);
    }
    #[test]
    fn detects_shared_layers_and_exclusive_space() {
        let root = temp();
        manifest(&root, "registry.ollama.ai/library/qwen/a", &[('a', 10), ('b', 1000), ('c', 50)]);
        manifest(&root, "registry.ollama.ai/library/qwen/b", &[('d', 10), ('b', 1000), ('e', 70)]);
        let s = scan(&root).unwrap();
        assert_eq!(s.total_bytes, 10 + 1000 + 50 + 10 + 70);
        let a = s.models.iter().find(|m| m.name == "qwen:a").unwrap();
        assert_eq!(a.shared_bytes, 1000);
        assert_eq!(a.exclusive_bytes, 60);
        assert!(a.layers.iter().any(|l| l.shared));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_folders_without_ollama_layout_and_never_writes() {
        let root = temp();
        assert!(scan(&root).is_err());
        let before: Vec<_> = fs::read_dir(&root).unwrap().collect();
        assert!(before.is_empty());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn ignores_invalid_digests() {
        let root = temp();
        let file = root.join("manifests/registry.ollama.ai/library/x/y");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::create_dir_all(root.join("blobs")).unwrap();
        fs::write(&file, r#"{"layers":[{"digest":"sha256:../../etc/passwd","size":5}]}"#).unwrap();
        let s = scan(&root).unwrap();
        assert!(s.models[0].layers.is_empty());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn candidate_roots_prefer_environment() {
        let r = candidate_roots(Some("/data/ollama".into()), Some(PathBuf::from("/home/u")));
        assert_eq!(r[0], PathBuf::from("/data/ollama"));
        assert_eq!(r[1], PathBuf::from("/home/u/.ollama/models"));
    }
    #[test]
    fn reports_system_memory() {
        let s = system_info();
        assert!(s.total_memory_bytes > 0);
        assert!(s.cpu_cores > 0);
    }
}
