# keychain-synced-storage

Secure storage adapter for Expo/React Native. Provides encrypted, biometric-protected session storage using the device's Keychain (iOS) or Keystore (Android).

## Overview

This library solves a key security challenge in mobile auth: **secure session persistence**. Rather than storing sensitive tokens or secrets in plain AsyncStorage, this adapter:

1. **In-memory virtual storage**: Maintains session data in a fast, in-memory Map that your app reads and writes to instantly (synchronous)
2. **Automatic encryption and persistence**: When you update data, it automatically encrypts it with a key stored in Keychain, then saves the encrypted blob to AsyncStorage in the background (non-blocking)
3. **Keychain-protected encryption key**: The encryption key lives in the device's secure Keychain/Keystore with optional biometric or passcode protection
4. **Isolated custom data namespaces**: Sensitive app data (e.g. private keys) can be stored in separate encrypted buckets that are never written during session updates
5. **Transparent to your app**: Once initialized, it works exactly like standard storage but with encryption and biometric protection underneath

### The Flow

```
Your App → setItem(key, value)
            ↓
         In-Memory Map (instant read/write)
            ↙                       ↘
    Return to app               Sync to storage (async)
    (synchronous)                   ↓
                                Background encryption with Keychain key
                                    ↓
                                AsyncStorage persists encrypted data

On app restart:
        ↓
    Load key from Keychain
        ↓
    Decrypt data from AsyncStorage
        ↓
    Restore In-Memory Map
```

## Installation

```bash
npm install keychain-synced-storage
```

### Peer Dependencies

Required packages and why they are needed:

- @react-native-async-storage/async-storage: used for data persistence
- react-native-keychain: stores the encryption key securely
- react-native-aes-crypto: encrypts and decrypts session data
- react-native: required runtime for native modules

## Usage

### 1. Initialize the Storage

Create a configuration file (e.g., `src/lib/storage.ts`):

```typescript
import { createKeychainSyncedStorage } from "keychain-synced-storage";

const storage = createKeychainSyncedStorage({
    storagePrefixKey: "com.myapp.auth",
});

// Register custom data namespaces BEFORE calling load()
// Each namespace has its own encrypted AsyncStorage key and independent version.
export const privateKeyStore = storage.registerCustomData({
    service: "private-key",
    version: 1,
});

export const {
    store: KeychainSyncedStore,
    load: initializeAuth,
    setEnableBiometrics,
    getBiometricsEnabled,
} = storage;
```

### 2. Initialize Before Using Storage

In your root layout or app initializer (e.g., `app/_layout.tsx`):

```typescript
import { useEffect, useState } from 'react';
import { initializeAuth } from './lib/storage';

export default function RootLayout() {
    const [isAuthReady, setIsAuthReady] = useState(false);

    useEffect(() => {
        initializeAuth()
            .then(() => {
                setIsAuthReady(true);
                console.log('Keychain storage initialized');
            })
            .catch(err => console.error('Auth init failed:', err));
    }, []);

    if (!isAuthReady) {
        return <SplashScreen />; // or loading UI
    }

    return <YourAppContent />;
}
```

`load()` is idempotent: concurrent or repeated calls share the same initialization. If it is canceled (e.g. the user dismisses the biometric prompt) or fails, calling `load()` again retries.

### 3. Use the Storage Directly

```typescript
import { KeychainSyncedStore } from "./lib/storage";

// Write
KeychainSyncedStore.setItem("session", JSON.stringify({ token: "..." }));

// Read
const session = KeychainSyncedStore.getItem("session");

// Async Read (waits for load() to finish before reading, if it was started)
const sessionAsync = await KeychainSyncedStore.getItemAsync("session");

// Async Write (waits for encryption sync to complete)
await KeychainSyncedStore.setItemAsync("session", JSON.stringify({ token: "..." }));

// Remove
KeychainSyncedStore.removeItem("session");

// Force flush all pending background syncs
await KeychainSyncedStore.flush();
```

### 4. Custom Data Namespaces

Use `registerCustomData()` to store sensitive app data (private keys, certificates, secrets) in a **separate encrypted bucket** isolated from the session data. Session writes never trigger a sync to the custom data bucket, reducing flash write cycles for rarely-changed data.

```typescript
import { privateKeyStore } from "./lib/storage";

// Store a private key
privateKeyStore.add("main", { privateKey: "...", publicKey: "..." });

// Retrieve it (returns null if not found)
const keypair = privateKeyStore.get<{ privateKey: string; publicKey: string }>("main");

// Delete it
privateKeyStore.delete("main");
```

**AsyncStorage keys** created by `registerCustomData`:
```
{storagePrefixKey}.custom.{service}.v{version}
// e.g. com.myapp.auth.custom.private-key.v1
```

Each namespace has its own version number, so you can migrate one namespace independently without affecting others.

## Usage with Better Auth

Install Better Auth packages separately (they are not required by this library).

### Create Your Auth Client

```typescript
import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { KeychainSyncedStore } from "./lib/storage";

export const authClient = createAuthClient({
    baseURL: "https://your-server.com",
    plugins: [
        expoClient({
            scheme: "myapp",
            storage: KeychainSyncedStore,
        }),
        // ... other plugins
    ],
});
```

## Configuration Options

```typescript
interface KeychainStorageOptions {
    // Biometric and auth prompt messages (optional)
    authPrompt?: {
        title?: string;    // default: "Authentication Required"
        subtitle?: string; // default: "Restoring your session"
        cancel?: string;   // default: "Cancel"
    };

    // Prefix for all stored keys (avoid collisions between apps)
    storagePrefixKey?: string; // default: 'kss'

    // Version for the session data blob in AsyncStorage.
    // Increment to invalidate old session data (forces fresh login).
    // Does NOT affect the Keychain entry or custom data namespaces.
    storageVersion?: number; // default: 1

    // Version for the Keychain entry and biometrics preference key.
    // Increment only for intentional key rotation (e.g. security incident).
    // Changing this generates a new encryption key — all stored data becomes inaccessible.
    keychainVersion?: number; // default: 1

    // Enable console logging for debugging
    enableLogging?: boolean; // default: false

    // Custom logger implementation
    logger?: {
        log: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
    };
}
```

### Versioning Strategy

| What changed | Which version to bump |
|---|---|
| Session data format needs to be cleared | `storageVersion` |
| Intentional encryption key rotation | `keychainVersion` |
| Custom data schema for one namespace | `version` in `registerCustomData()` |

Bumping `storageVersion` clears the session data blob but leaves the Keychain entry and all custom data intact. Bumping `keychainVersion` generates a new encryption key — all data (session and custom) stored under the old key becomes inaccessible.

## Multi-Session Support

This adapter is fully compatible with [better-auth's multi-session plugin](https://www.better-auth.com/docs/plugins/multi-session), allowing users to maintain multiple authenticated sessions simultaneously each encrypted and keychain-protected.

```typescript
import { multiSessionClient } from "better-auth/client/plugins";

const authClient = createAuthClient({
    plugins: [
        expoClient({
            /* ... */
        }),
        multiSessionClient(), // Enable multiple sessions
    ],
});
```

## Configuring Keychain Security Level

By default, the encryption key is stored in Keychain with passcode-only protection. You can toggle biometric authentication at any time during your app's lifecycle, such as from a settings page.

The `setEnableBiometrics()` function switches the encryption key between two security modes:

```typescript
import { setEnableBiometrics } from "./lib/storage";

// Enable biometric-protected key access
// On Android: requires biometric enrollment; on iOS: enables Touch ID / Face ID
await setEnableBiometrics(true);

// Disable and revert to passcode-only protection
await setEnableBiometrics(false);
```

### How It Works

When you call `setEnableBiometrics()`:

1. **Key verification**: If biometric was already enabled, the user is prompted to authenticate (biometric or passcode) to verify they have access to the current key
2. **Key rotation**: A new encryption key is generated
3. **Data re-encryption**: All session data and all registered custom data namespaces are re-encrypted with the new key atomically
4. **Keychain update**: The new key is saved to Keychain with the specified protection level (biometric or passcode-only)

**Important**: Do not call `setEnableBiometrics()` multiple times in rapid succession. There may be a race condition in `react-native-keychain` that requires time to complete each operation safely. If you need to toggle the setting, ensure there is sufficient time between calls or debounce the function.

Note: Device must have biometric data enrolled to enable biometric protection. Biometric support is handled by `react-native-keychain` and the device's native Keychain/Keystore APIs.

## Security Considerations

### What This Protects Against

- **Plaintext token theft**: Values are encrypted before being written to AsyncStorage (AES-256-CBC)
- **Casual storage inspection**: AsyncStorage contains only encrypted blobs, not raw tokens
- **Key protection via OS secure storage**: The encryption key is stored using Keychain/Keystore via `react-native-keychain`
- **Biometric-gated key access (when enabled)**: With biometrics enabled, key access requires biometric or device passcode, depending on platform support
- **Custom data confidentiality**: Sensitive app data is stored in isolated encrypted namespaces, insulated from high-frequency session writes

### Limitations

- **Runtime exposure**: Decrypted values live in memory while the app is running. A compromised app process can read them.
- **No integrity protection for stored blobs**: AES-CBC provides confidentiality but not tamper detection. If the stored ciphertext is modified, decryption may fail or produce corrupted data.
- **Biometrics are optional**: When biometrics are disabled, the key is still stored in Keychain/Keystore but access is not gated by biometric prompts.
- **Device security and hardware variance**: On Android, hardware-backed protection is best-effort and depends on device support (StrongBox vs TEE).
- **Rooted/Jailbroken devices**: Full device compromise can bypass OS protections and expose app data.
- **Server-side responsibility**: This library only secures client-side storage. Your backend must still implement proper authentication, token expiry, rate limiting, and authorization.

## Roadmap

- Add optional callbacks for `setItem()` and `removeItem()` to confirm when data has been persisted to AsyncStorage

## Contributing

Issues and PRs welcome! Please include:

- React Native / Expo version
- iOS or Android (or both)
- Steps to reproduce
- Relevant logs with `enableLogging: true`

## License

MIT

## Related Links

- [better-auth Documentation](https://better-auth.com)
- [better-auth Multi-Session Plugin](https://www.better-auth.com/docs/plugins/multi-session)
- [react-native-keychain](https://github.com/oblador/react-native-keychain)
- [react-native-aes-crypto](https://github.com/tectiv3/react-native-aes)
