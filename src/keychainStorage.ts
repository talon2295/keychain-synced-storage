import * as Keychain from "react-native-keychain";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import Aes from "react-native-aes-crypto";

export interface KeychainStorageOptions {
    authPrompt?: {
        title?: string;
        subtitle?: string;
        cancel?: string;
    };
    storagePrefixKey?: string;
    storageVersion?: number;
    enableLogging?: boolean;
    logger?: {
        log: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
    };
}

interface KeychainStorageConfig {
    serviceName: string;
    encryptionKeyUsername: string;
    biometricsPreferenceKey: string;
    encryptedDataKey: string;
    encryptionSalt: string;
    keychainOptions: Keychain.SetOptions;
    keychainOptionsWithBiometrics: Keychain.SetOptions;
    keychainOptionsWithoutBiometrics: Keychain.SetOptions;
}

const DEFAULT_STORAGE_VERSION = 1;

const createLogger = (options: KeychainStorageOptions) => {
    if (!options.enableLogging) {
        return {
            log: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        };
    }

    return options.logger ?? console;
};

const createConfig = (
    options: KeychainStorageOptions,
): KeychainStorageConfig => {
    const storageVersion = options.storageVersion ?? DEFAULT_STORAGE_VERSION;
    const prefix = options.storagePrefixKey ?? "kss"; // Keychain Synced Storage

    const serviceName = `${prefix}.service.v${storageVersion}`;
    const encryptionKeyUsername = `${prefix}.key.v${storageVersion}`;
    const biometricsPreferenceKey = `${prefix}.enabled.v${storageVersion}`;
    const encryptedDataKey = `${prefix}.storage.v${storageVersion}`;
    const encryptionSalt = `${prefix}.salt.v${storageVersion}`;

    const keychainOptions: Keychain.SetOptions = {
        service: serviceName,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    };

    const keychainOptionsWithBiometrics: Keychain.SetOptions = {
        ...keychainOptions,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        accessControl:
            Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET_OR_DEVICE_PASSCODE,
        securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
        storage: Keychain.STORAGE_TYPE.AES_GCM,
    };

    const keychainOptionsWithoutBiometrics: Keychain.SetOptions = {
        ...keychainOptions,
        securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
    };

    return {
        serviceName,
        encryptionKeyUsername,
        biometricsPreferenceKey,
        encryptedDataKey,
        encryptionSalt,
        keychainOptions,
        keychainOptionsWithBiometrics,
        keychainOptionsWithoutBiometrics,
    };
};

const generateKey = async (salt: string) => {
    const key = await Aes.randomKey(64);
    return await Aes.pbkdf2(key, salt, 5000, 256, "sha512");
};

class KeychainSyncedStore {
    private memory: Map<string, string> = new Map();
    private options: KeychainStorageOptions;
    private config: KeychainStorageConfig;
    private biometricsEnabled: boolean = false;
    private encryptionKey: string | null = null;
    private logger: {
        log: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
    };

    constructor(options: KeychainStorageOptions = {}) {
        this.options = options;
        this.config = createConfig(options);
        this.logger = createLogger(options);
    }

    private async loadBiometricsPreference() {
        try {
            const value = await AsyncStorage.getItem(
                this.config.biometricsPreferenceKey,
            );
            this.biometricsEnabled = value === "true";
            this.logger.log(
                `[KeychainStore] Biometrics preference loaded: ${this.biometricsEnabled}`,
            );
        } catch (error) {
            this.logger.error(
                "[KeychainStore] Failed to load biometrics preference:",
                error,
            );
        }
    }

    getItem(key: string): string | null {
        const value = this.memory.get(key);
        this.logger.log(
            `[KeychainStore] getItem(${key}) => ${value ? "FOUND" : "NULL"}`,
        );
        return value ?? null;
    }

    setItem(key: string, value: string): void {
        this.logger.log(`[KeychainStore] setItem(${key})`);
        this.memory.set(key, value);
        this.syncToStorage().catch((err) =>
            this.logger.error(
                "[KeychainStore] Background sync to storage failed:",
                err,
            ),
        );
    }

    removeItem(key: string): void {
        this.logger.log(`[KeychainStore] removeItem(${key})`);
        if (this.memory.has(key)) {
            this.memory.delete(key);
            this.syncToStorage().catch((err) =>
                this.logger.error(
                    "[KeychainStore] Background sync on remove failed:",
                    err,
                ),
            );
        }
    }

    async initialize(): Promise<void> {
        if (Platform.OS === "web") {
            return;
        }

        try {
            this.logger.log("[KeychainStore] Initializing store...");
            await this.loadBiometricsPreference();

            let key = await this.getEncryptionKeyFromKeychain();

            if (!key) {
                this.logger.log(
                    "[KeychainStore] No encryption key found. Generating a new one.",
                );
                key = await generateKey(this.config.encryptionSalt);
                await this.saveEncryptionKeyToKeychain(key);
            }
            this.encryptionKey = key;
            this.logger.log("[KeychainStore] Encryption key is ready.");

            const encryptedData = await AsyncStorage.getItem(
                this.config.encryptedDataKey,
            );
            if (encryptedData) {
                const decryptedData = await this.decryptData(encryptedData);
                this.memory = new Map(
                    Object.entries(JSON.parse(decryptedData)),
                );
                this.logger.log(
                    `[KeychainStore] Loaded and decrypted ${this.memory.size} items.`,
                );
            } else {
                this.logger.log("[KeychainStore] No data found in storage.");
            }
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.includes("User canceled")
            ) {
                this.logger.log(
                    "[KeychainStore] User canceled biometric prompt during key retrieval.",
                );
                this.memory.clear();
                this.encryptionKey = null;
            } else {
                this.logger.error(
                    "[KeychainStore] Failed to initialize:",
                    error,
                );
            }
        }
    }

    async setEnableBiometrics(enabled: boolean): Promise<void> {
        if (Platform.OS === "web" || this.encryptionKey === null) {
            return;
        }

        this.logger.log(
            `[KeychainStore] Rolling key to set biometrics: ${enabled}`,
        );
        try {
            if (this.biometricsEnabled) {
                //Ensure user can access current key before change it
                await this.getEncryptionKeyFromKeychain();
            }
            const dataToReEncrypt = Object.fromEntries(this.memory);
            const newKey = await generateKey(this.config.encryptionSalt);
            const encryptedData = await this.encryptData(
                JSON.stringify(dataToReEncrypt),
                newKey,
            );

            await AsyncStorage.setItem(
                this.config.encryptedDataKey,
                encryptedData,
            );
            await this.saveEncryptionKeyToKeychain(newKey, enabled);

            this.encryptionKey = newKey;
            this.biometricsEnabled = enabled;
            await AsyncStorage.setItem(
                this.config.biometricsPreferenceKey,
                String(enabled),
            );

            this.logger.log(
                "[KeychainStore] Key roll successful. Biometrics preference updated.",
            );
        } catch (error) {
            this.logger.error(
                "[KeychainStore] Failed to roll key for biometrics:",
                error,
            );
            throw error;
        }
    }

    getBiometricsEnabled(): boolean {
        return this.biometricsEnabled;
    }

    private async getEncryptionKeyFromKeychain(): Promise<string | null> {
        const credentials = await Keychain.getGenericPassword({
            service: this.config.serviceName,
            ...(this.biometricsEnabled
                ? {
                      ...this.config.keychainOptionsWithBiometrics,
                      authenticationPrompt: {
                          title:
                              this.options.authPrompt?.title ||
                              "Authentication Required",
                          subtitle:
                              this.options.authPrompt?.subtitle ||
                              "Restoring your session",
                          cancel: this.options.authPrompt?.cancel || "Cancel",
                      },
                  }
                : this.config.keychainOptionsWithoutBiometrics),
        });
        return credentials && typeof credentials !== "boolean"
            ? credentials.password
            : null;
    }

    private async saveEncryptionKeyToKeychain(
        key: string,
        biometrics: boolean = this.biometricsEnabled,
    ) {
        await Keychain.setGenericPassword(
            this.config.encryptionKeyUsername,
            key,
            biometrics
                ? {
                      ...this.config.keychainOptionsWithBiometrics,
                      authenticationPrompt: {
                          title:
                              this.options.authPrompt?.title ||
                              "Authentication Required",
                          subtitle:
                              this.options.authPrompt?.subtitle ||
                              "Restoring your session",
                          cancel: this.options.authPrompt?.cancel || "Cancel",
                      },
                  }
                : this.config.keychainOptionsWithoutBiometrics,
        );
    }

    private async encryptData(data: string, key: string): Promise<string> {
        const iv = await Aes.randomKey(16);
        const ciphertext = await Aes.encrypt(data, key, iv, "aes-256-cbc");
        return JSON.stringify({ iv, ciphertext });
    }

    private async decryptData(encryptedJson: string): Promise<string> {
        if (!this.encryptionKey) {
            throw new Error(
                "Decryption failed: Encryption key is not available.",
            );
        }
        const { iv, ciphertext } = JSON.parse(encryptedJson);
        return Aes.decrypt(ciphertext, this.encryptionKey, iv, "aes-256-cbc");
    }

    private async syncToStorage(): Promise<void> {
        if (Platform.OS === "web" || !this.encryptionKey) {
            return;
        }

        this.logger.log(
            "[KeychainStore] Syncing in-memory state to storage...",
        );

        try {
            const data = JSON.stringify(Object.fromEntries(this.memory));
            const encryptedData = await this.encryptData(
                data,
                this.encryptionKey,
            );
            await AsyncStorage.setItem(
                this.config.encryptedDataKey,
                encryptedData,
            );
            this.logger.log(
                "[KeychainStore] Synced encrypted state to AsyncStorage.",
            );
        } catch (error) {
            this.logger.error(
                "[KeychainStore] Error syncing to AsyncStorage:",
                error,
            );
        }
    }
}

export const createKeychainSyncedStorage = (
    options: KeychainStorageOptions = {},
): {
    store: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
        removeItem: (key: string) => void;
    };
    load: () => Promise<void>;
    setEnableBiometrics: (enabled: boolean) => Promise<void>;
    getBiometricsEnabled: () => boolean;
} => {
    const store = new KeychainSyncedStore(options);

    return {
        store: {
            getItem: store.getItem.bind(store),
            setItem: store.setItem.bind(store),
            removeItem: store.removeItem.bind(store),
        },
        load: () => store.initialize(),
        setEnableBiometrics: (enabled: boolean) =>
            store.setEnableBiometrics(enabled),
        getBiometricsEnabled: () => store.getBiometricsEnabled(),
    };
};

export const getSupportedBiometryType = Keychain.getSupportedBiometryType;
