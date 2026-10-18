use rusqlite::{params, Connection, OptionalExtension};
use std::sync::Mutex;
use tauri::{Manager, State};

mod models;

struct LocalStore(Mutex<Connection>);
fn valid_id(id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map(|_| ()).map_err(|_| "Identificador de sesión no válido".to_string())
}
fn metadata_id(metadata: &str) -> Result<String, String> {
    if metadata.len() > 8 * 1024 * 1024 { return Err("Metadatos demasiado grandes".into()); }
    let value: serde_json::Value = serde_json::from_str(metadata).map_err(|e| e.to_string())?;
    if value.get("schemaVersion").and_then(|v| v.as_u64()) != Some(1) { return Err("Esquema no compatible".into()); }
    let id = value.get("id").and_then(|v| v.as_str()).ok_or("Falta el identificador")?;
    valid_id(id)?;
    let title = value.get("title").and_then(|v| v.as_str()).ok_or("Falta el título")?;
    if title.is_empty() || title.chars().count() > 120 { return Err("Título no válido".into()); }
    Ok(id.into())
}

#[tauri::command]
async fn save_session(state: State<'_, LocalStore>, metadata: String, audio: Option<Vec<u8>>) -> Result<(), String> {
    let id = metadata_id(&metadata)?;
    if audio.as_ref().is_some_and(|a| a.len() > 25 * 1024 * 1024) { return Err("El audio supera 25 MB".into()); }
    let conn = state.0.lock().map_err(|_| "Almacenamiento bloqueado")?;
    conn.execute("INSERT INTO sessions(id,metadata,audio) VALUES(?1,?2,?3)
        ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,audio=COALESCE(excluded.audio,sessions.audio)",
        params![id, metadata, audio]).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
async fn list_sessions(state: State<'_, LocalStore>) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|_| "Almacenamiento bloqueado")?;
    let mut statement = conn.prepare("SELECT metadata FROM sessions").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| row.get(0)).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<String>, _>>().map_err(|e| e.to_string())
}
#[tauri::command]
async fn get_session(state: State<'_, LocalStore>, id: String) -> Result<Option<String>, String> {
    valid_id(&id)?;
    let conn = state.0.lock().map_err(|_| "Almacenamiento bloqueado")?;
    conn.query_row("SELECT metadata FROM sessions WHERE id=?1", [id], |r| r.get(0))
        .optional().map_err(|e| e.to_string())
}
#[tauri::command]
async fn read_audio(state: State<'_, LocalStore>, id: String) -> Result<Option<Vec<u8>>, String> {
    valid_id(&id)?;
    let conn = state.0.lock().map_err(|_| "Almacenamiento bloqueado")?;
    let bytes: Option<Option<Vec<u8>>> = conn.query_row("SELECT audio FROM sessions WHERE id=?1", [id], |r| r.get(0))
        .optional().map_err(|e| e.to_string())?;
    Ok(bytes.flatten())
}
#[tauri::command]
async fn delete_session(state: State<'_, LocalStore>, id: String) -> Result<(), String> {
    valid_id(&id)?;
    let conn = state.0.lock().map_err(|_| "Almacenamiento bloqueado")?;
    conn.execute("DELETE FROM sessions WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Memoria, CPU y sistema operativo, para recomendar modelos con datos reales.
#[tauri::command]
async fn system_info() -> Result<models::SystemInfo, String> {
    Ok(models::system_info())
}
/// Lee (sin modificar) los manifiestos de Ollama para calcular capas compartidas y el espacio real.
#[tauri::command]
async fn ollama_storage(app: tauri::AppHandle) -> Result<models::OllamaStorage, String> {
    let roots = models::candidate_roots(std::env::var("OLLAMA_MODELS").ok(), app.path().home_dir().ok());
    tauri::async_runtime::spawn_blocking(move || models::find_and_scan(&roots)).await.map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            std::fs::create_dir_all(&directory)?;
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
            }
            let conn = Connection::open(directory.join("oratoria-lab.sqlite3"))?;
            conn.execute_batch("PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,metadata TEXT NOT NULL,audio BLOB);")?;
            app.manage(LocalStore(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![save_session, list_sessions, get_session, read_audio, delete_session, system_info, ollama_storage])
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar Oratoria Lab");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_as_session_ids() { assert!(valid_id("../../private").is_err()); }
    #[test]
    fn validates_metadata_before_writing() {
        assert!(metadata_id("{}").is_err());
        assert!(metadata_id(r#"{"schemaVersion":1,"id":"18c8ce61-d2e3-4f57-9b46-d7c1594424ce","title":"Práctica"}"#).is_ok());
    }
    #[test]
    fn sqlite_updates_preserve_audio() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE sessions(id TEXT PRIMARY KEY,metadata TEXT NOT NULL,audio BLOB);").unwrap();
        conn.execute("INSERT INTO sessions VALUES(?1,?2,?3)", params!["a", "first", vec![1_u8, 2, 3]]).unwrap();
        conn.execute("INSERT INTO sessions VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata,audio=COALESCE(excluded.audio,sessions.audio)", params!["a", "edited", Option::<Vec<u8>>::None]).unwrap();
        let audio: Vec<u8> = conn.query_row("SELECT audio FROM sessions", [], |r| r.get(0)).unwrap();
        assert_eq!(audio, vec![1, 2, 3]);
    }
}
