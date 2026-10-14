fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "save_session", "list_sessions", "get_session", "read_audio", "delete_session",
            ]),
        ),
    ).expect("No se pudo preparar la configuración de Tauri");
}
