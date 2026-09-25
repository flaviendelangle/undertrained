fn main() {
    // Images referenced from .slint are embedded in the binary as files, so the window icon
    // does not depend on a path at run time. An embedded file also carries the stable cache
    // key the winit backend needs before it forwards the icon to the desktop; an image built
    // from pixels at run time has none, and the icon would never be set. The winit backend
    // brings Slint's PNG decoder, so no extra feature is needed. Texture embedding is avoided
    // on purpose: it also pre-renders glyphs and degrades text.
    //
    // Translations are bundled from ui/lang/<lang>/LC_MESSAGES/undertrained-indoor.po, keyed
    // by the English source string alone (no per-component context), and selected at run time.
    let config = slint_build::CompilerConfiguration::new()
        .embed_resources(slint_build::EmbedResourcesKind::EmbedFiles)
        .with_bundled_translations("ui/lang")
        .with_default_translation_context(slint_build::DefaultTranslationContext::None);
    slint_build::compile_with_config("ui/app.slint", config)
        .expect("Unable to compile the interface");
}
