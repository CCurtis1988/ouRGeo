/** Candidate distributions are immutable/checksummed; certification remains
 * separate from availability. A source pin alone is not an install approval. */
export const MNEMOSYNE_LOCAL_CANDIDATE = {
  id: 'mnemosyne-lexical-v1', certification: 'pending',
  // The v0.7.4 tag names the Hermes plugin. The engine at that same commit is
  // 4.0.0b4; it must not be presented as a stable core release or default.
  provider: { release: 'v4.0.0b4', engineVersion: '4.0.0b4', pluginRelease: 'v0.7.4', experimental: true, commit: 'e871f39480b9b9156faa4396162f7ec1f3b11525',
    archive: { url: 'https://codeload.github.com/mnemosyne-oss/mnemosyne/tar.gz/e871f39480b9b9156faa4396162f7ec1f3b11525', sha256: '4a78f00c6f2e683a89e8d6f0e4fb682a5077888be44270fbe777e5e9516f4f72', root: 'mnemosyne-e871f39480b9b9156faa4396162f7ec1f3b11525', maxBytes: 10_000_000 } },
  python: { version: '3.12.15', distribution: 'astral-sh/python-build-standalone', release: '20261003',
    profiles: {
      'linux-x64': { url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.12.15%2B20261003-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz', sha256: '731af898886c5f821890dc901eca3c651cca8e51fa7308c159d12a1194aeac91', root: 'python', maxBytes: 35_000_000, caseSensitive: true },
      'darwin-arm64': { url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.12.15%2B20261003-aarch64-apple-darwin-install_only_stripped.tar.gz', sha256: 'ad8d0c637c0a36b967b310e2c07254f4d2ca8cabaa7699e55ed6290aceb481a2', root: 'python', maxBytes: 26_000_000 },
      'win32-x64': { url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.12.15%2B20261003-x86_64-pc-windows-msvc-install_only_stripped.tar.gz', sha256: '6fba7f2ae506facf41d457ea8293c7497910a675c69a4e954875169410a50402', root: 'python', maxBytes: 23_000_000 },
    },
  },
  yaml: { version: '6.0.3', archive: { url: 'https://files.pythonhosted.org/packages/05/8e/961c0007c59b8dd7729d542c61a4d537767a59645b82a0b521206e1e25c2/pyyaml-6.0.3.tar.gz', sha256: 'd76623373421df22fb4cf8817020cbb7ef15c725b9d5e45f17e189bfc384190f', root: 'pyyaml-6.0.3', maxBytes: 150_000 } },
  processing: 'local-only', embeddings: 'disabled', extraction: 'disabled', reflection: 'disabled', sync: 'disabled',
  providerStorage: 'readable-sqlite', canonicalStorage: 'os-keyring-encrypted',
} as const
