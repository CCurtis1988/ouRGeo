// Vitest global setup: register jest-dom matchers (toBeInTheDocument, etc.)
// on Vitest's expect. Safe to load in the node environment too — it only
// extends the matcher set and does not touch the DOM at import time.
import '@testing-library/jest-dom/vitest'
