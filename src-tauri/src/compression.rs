use base64::{engine::general_purpose::STANDARD as B64, Engine};
use flate2::read::{GzDecoder, GzEncoder};
use flate2::Compression;
use std::io::Read;

#[tauri::command]
pub fn compress_gzip(data: String, level: Option<u32>) -> Result<String, String> {
    let level = level.unwrap_or(6);
    let mut encoder = GzEncoder::new(data.as_bytes(), Compression::new(level));
    let mut buf = Vec::new();
    encoder.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(B64.encode(&buf))
}

#[tauri::command]
pub fn decompress_gunzip(data: String) -> Result<String, String> {
    let compressed = B64.decode(&data).map_err(|e| e.to_string())?;
    let mut decoder = GzDecoder::new(&compressed[..]);
    let mut result = String::new();
    decoder
        .read_to_string(&mut result)
        .map_err(|e| e.to_string())?;
    Ok(result)
}
