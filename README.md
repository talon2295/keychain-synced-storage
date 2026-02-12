# keychain-synced-storage

Secure storage adapter for Expo/React Native. Provides encrypted, biometric-protected session storage using the device's Keychain (iOS) or Keystore (Android).

## Overview

This library solves a key security challenge in mobile auth: **secure session persistence**. Rather than storing sensitive tokens or secrets in plain AsyncStorage, this adapter:

1. **In-memory virtual storage**: Maintains session data in a fast, in-memory Map that your app reads and writes to instantly (synchronous)
2. **Automatic encryption and persistence**: When you update data, it automatically encrypts it with a key stored in Keychain, then saves the encrypted blob to AsyncStorage in the background (non-blocking)
3. **Keychain-protected encryption key**: The encryption key lives in the device's secure Keychain/Keystore with optional biometric or passcode protection
4. **Transparent to your app**: Once initialized, it works exactly like standard storage but with encryption and biometric protection underneath

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

const {
    store: KeychainSyncedStore,
    load: initializeAuth,
    setEnableBiometrics,
    getBiometricsEnabled,
} = createKeychainSyncedStorage({
    storagePrefixKey: "com.myapp.auth",
});

export {
    initializeAuth,
    setEnableBiometrics,
    getBiometricsEnabled,
    KeychainSyncedStore,
};
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

### 3. Use the Storage Directly

```typescript
import { KeychainSyncedStore } from "./lib/storage";

// Write
KeychainSyncedStore.setItem("session", JSON.stringify({ token: "..." }));

// Read
const session = KeychainSyncedStore.getItem("session");

// Remove
KeychainSyncedStore.removeItem("session");
```

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
        title?: string; // default: "Authentication Required"
        subtitle?: string; // default: "Restoring your session"
        cancel?: string; // default: "Cancel"
    };

    // Prefix for all stored keys (avoid collisions between apps)
    storagePrefixKey?: string; // default: 'kss'

    // Storage version for key naming (increment to invalidate old encrypted data)
    storageVersion?: number; // default: 1

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
import { setEnableBiometrics } from "./lib/auth";

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
3. **Data re-encryption**: All stored session data is encrypted with the new key
4. **Keychain update**: The new key is saved to Keychain with the specified protection level (biometric or passcode-only)

This approach ensures security even though the data itself doesn't change: by rotating the key, you prevent unauthorized access if the biometric setting is toggled.

**Important**: Do not call `setEnableBiometrics()` multiple times in rapid succession. There may be a race condition in `react-native-keychain` that requires time to complete each operation safely. Calling it too quickly could potentially corrupt the stored key. If you need to toggle the setting, ensure there is sufficient time between calls or debounce the function.

Note: Device must have biometric data enrolled to enable biometric protection. Biometric support is handled by `react-native-keychain` and the device's native Keychain/Keystore APIs.

## Security Considerations

### What This Protects Against

- **Plaintext token theft**: Tokens are encrypted at rest in AsyncStorage
- **Casual storage inspection**: Anyone reading AsyncStorage files only sees encrypted blobs
- **Unauthorized key access**: The encryption key is locked in device Keychain and requires biometric or passcode
- **App-level compromise**: Even if your app is compromised, accessing tokens requires the Keychain key

### Limitations

- **Rooted/Jailbroken devices**: An attacker with full device control can potentially bypass Keychain protections
- **Malicious APK modification**: If your app code is modified with malware, keys can be intercepted at runtime during decryption
- **Weak user authentication**: If the user disables biometric or uses a weak passcode, key security degrades
- **Server-side responsibility**: This library only secures client-side storage. Your backend must still implement proper authentication, token expiry, rate limiting, and authorization

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
