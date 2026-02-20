fn main() {
    // Force rebuild when frontend dist changes
    println!("cargo:rerun-if-changed=../apps/web/build");

    // OpenSSL lib path for sqlcipher on Windows
    #[cfg(target_os = "windows")]
    {
        println!("cargo:rustc-link-search=native=C:/Program Files/OpenSSL-Win64/lib/VC/x64/MT");
    }

    tauri_build::build()
}
