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
    keychainVersion?: number;
    enableLogging?: boolean;
    logger?: {
        log: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
    };
}

export interface CustomDataRegistration {
    service: string;
    version?: number;
}

export interface CustomDataAccessor {
    add<T>(keyName: string, data: T): void;
    get<T>(keyName: string): T | null;
    delete(keyName: string): void;
}

type Logger = {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};

interface KeychainStorageConfig {
    prefix: string;
    serviceName: string;
    encryptionKeyUsername: string;
    biometricsPreferenceKey: string;
    encryptedDataKey: string;
    keychainOptions: Keychain.SetOptions;
    keychainOptionsWithBiometrics: Keychain.SetOptions;
    keychainOptionsWithoutBiometrics: Keychain.SetOptions;
}

const DEFAULT_STORAGE_VERSION = 1;

const createLogger = (options: KeychainStorageOptions): Logger => {
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
    const keychainVersion = options.keychainVersion ?? DEFAULT_STORAGE_VERSION;
    const prefix = options.storagePrefixKey ?? "kss"; // Keychain Synced Storage

    const serviceName = `${prefix}.service.v${keychainVersion}`;
    const encryptionKeyUsername = `${prefix}.key.v${keychainVersion}`;
    const biometricsPreferenceKey = `${prefix}.enabled.v${keychainVersion}`;
    const encryptedDataKey = `${prefix}.storage.v${storageVersion}`;

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
        storage: Keychain.STORAGE_TYPE.RSA,
    };

    const keychainOptionsWithoutBiometrics: Keychain.SetOptions = {
        ...keychainOptions,
        securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
    };

    return {
        prefix,
        serviceName,
        encryptionKeyUsername,
        biometricsPreferenceKey,
        encryptedDataKey,
        keychainOptions,
        keychainOptionsWithBiometrics,
        keychainOptionsWithoutBiometrics,
    };
};

const generateKey = async () => {
    return await Aes.randomKey(32); // AES-256 key
};

const encryptData = async (data: string, key: string): Promise<string> => {
    const iv = await Aes.randomKey(16);
    const ciphertext = await Aes.encrypt(data, key, iv, "aes-256-cbc");
    return JSON.stringify({ iv, ciphertext });
};

const decryptData = async (
    encryptedJson: string,
    key: string,
): Promise<string> => {
    const { iv, ciphertext } = JSON.parse(encryptedJson);
    return Aes.decrypt(ciphertext, key, iv, "aes-256-cbc");
};

class CustomDataStore {
    private memory: Map<string, string> = new Map();
    private syncLock: Promise<void> = Promise.resolve();
    private storageKey: string;
    private getKey: () => string | null;
    private logger: Logger;

    constructor(
        storageKey: string,
        getKey: () => string | null,
        logger: Logger,
    ) {
        this.storageKey = storageKey;
        this.getKey = getKey;
        this.logger = logger;
    }

    add<T>(keyName: string, data: T): void {
        this.logger.log(`[CustomDataStore] add(${this.storageKey}, ${keyName})`);
        this.memory.set(keyName, JSON.stringify(data));
        this.syncToStorage();
    }

    get<T>(keyName: string): T | null {
        const value = this.memory.get(keyName);
        this.logger.log(
            `[CustomDataStore] get(${this.storageKey}, ${keyName}) => ${value ? "FOUND" : "NULL"}`,
        );
        return value ? (JSON.parse(value) as T) : null;
    }

    delete(keyName: string): void {
        this.logger.log(
            `[CustomDataStore] delete(${this.storageKey}, ${keyName})`,
        );
        if (this.memory.has(keyName)) {
            this.memory.delete(keyName);
            this.syncToStorage();
        }
    }

    async initialize(): Promise<void> {
        const key = this.getKey();
        if (!key) return;

        this.logger.log(
            `[CustomDataStore] Initializing store: ${this.storageKey}`,
        );
        const encrypted = await AsyncStorage.getItem(this.storageKey);
        if (encrypted) {
            const decrypted = await decryptData(encrypted, key);
            this.memory = new Map(
                Object.entries(JSON.parse(decrypted)),
            ) as Map<string, string>;
            this.logger.log(
                `[CustomDataStore] Loaded ${this.memory.size} items from ${this.storageKey}`,
            );
        }
    }

    async reEncrypt(newKey: string): Promise<void> {
        this.logger.log(
            `[CustomDataStore] Re-encrypting store: ${this.storageKey}`,
        );
        await this.flush();
        const data = JSON.stringify(Object.fromEntries(this.memory));
        const encrypted = await encryptData(data, newKey);
        await AsyncStorage.setItem(this.storageKey, encrypted);
    }

    async flush(): Promise<void> {
        const flushPromise = this.syncLock.then(() => this._performSync());
        this.syncLock = flushPromise.catch(() => undefined);
        return flushPromise;
    }

    private syncToStorage(): void {
        this.syncLock = this.syncLock
            .then(() => this._performSync())
            .catch((error) => {
                this.logger.error(
                    `[CustomDataStore] Error syncing ${this.storageKey}:`,
                    error,
                );
            });
    }

    private async _performSync(): Promise<void> {
        if (Platform.OS === "web") return;

        const key = this.getKey();
        if (!key) return;

        this.logger.log(
            `[CustomDataStore] Syncing store: ${this.storageKey}`,
        );
        const encrypted = await encryptData(
            JSON.stringify(Object.fromEntries(this.memory)),
            key,
        );
        await AsyncStorage.setItem(this.storageKey, encrypted);
    }
}

class KeychainSyncedStore {
    private memory: Map<string, string> = new Map();
    private options: KeychainStorageOptions;
    private config: KeychainStorageConfig;
    private biometricsEnabled: boolean = false;
    private encryptionKey: string | null = null;
    private syncLock: Promise<void> = Promise.resolve();
    private logger: Logger;
    private customDataStores: Map<string, CustomDataStore> = new Map();

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
        this.syncToStorage();
    }

    async setItemAsync(key: string, value: string): Promise<void> {
        this.logger.log(`[KeychainStore] setItemAsync(${key})`);
        this.memory.set(key, value);
        try {
            await this.flush();
        } catch (err) {
            this.logger.error(
                "[KeychainStore] Background sync to storage failed:",
                err,
            );
            throw new Error(err instanceof Error ? err.message : String(err));
        }
    }

    removeItem(key: string): void {
        this.logger.log(`[KeychainStore] removeItem(${key})`);
        if (this.memory.has(key)) {
            this.memory.delete(key);
            this.syncToStorage();
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
                key = await generateKey();
                await this.saveEncryptionKeyToKeychain(key);
            }
            this.encryptionKey = key;
            this.logger.log("[KeychainStore] Encryption key is ready.");

            const hadPreInitData = this.memory.size > 0;

            const encryptedData = await AsyncStorage.getItem(
                this.config.encryptedDataKey,
            );
            if (encryptedData) {
                const decryptedData = await decryptData(encryptedData, key);
                const storedData = new Map(
                    Object.entries(JSON.parse(decryptedData)),
                ) as Map<string, string>;
                // Merge: stored data as base, pre-init in-memory writes take priority
                this.memory = new Map([...storedData, ...this.memory]);
                this.logger.log(
                    `[KeychainStore] Loaded and decrypted ${storedData.size} items from storage.`,
                );
            } else {
                this.logger.log("[KeychainStore] No data found in storage.");
            }

            // Initialize all registered custom data stores in parallel
            if (this.customDataStores.size > 0) {
                await Promise.all(
                    [...this.customDataStores.values()].map((s) =>
                        s.initialize(),
                    ),
                );
            }

            // Persist any pre-init writes that couldn't sync before the key was available
            if (hadPreInitData) {
                this.syncToStorage();
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
            const newKey = await generateKey();
            const encryptedData = await encryptData(
                JSON.stringify(dataToReEncrypt),
                newKey,
            );

            await AsyncStorage.setItem(
                this.config.encryptedDataKey,
                encryptedData,
            );

            // Re-encrypt all custom data stores with the new key before saving it
            if (this.customDataStores.size > 0) {
                await Promise.all(
                    [...this.customDataStores.values()].map((s) =>
                        s.reEncrypt(newKey),
                    ),
                );
            }

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

    registerCustomData(config: CustomDataRegistration): CustomDataAccessor {
        const version = config.version ?? 1;
        const storageKey = `${this.config.prefix}.custom.${config.service}.v${version}`;
        const store = new CustomDataStore(
            storageKey,
            () => this.encryptionKey,
            this.logger,
        );
        this.customDataStores.set(config.service, store);
        return {
            add: <T>(keyName: string, data: T) => store.add(keyName, data),
            get: <T>(keyName: string) => store.get<T>(keyName),
            delete: (keyName: string) => store.delete(keyName),
        };
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

    private async _performSync(): Promise<void> {
        if (Platform.OS === "web" || !this.encryptionKey) {
            return;
        }

        this.logger.log(
            "[KeychainStore] Syncing in-memory state to storage...",
        );

        const data = JSON.stringify(Object.fromEntries(this.memory));
        const encryptedData = await encryptData(data, this.encryptionKey);
        await AsyncStorage.setItem(this.config.encryptedDataKey, encryptedData);
        this.logger.log(
            "[KeychainStore] Synced encrypted state to AsyncStorage.",
        );
    }

    private syncToStorage(): void {
        this.syncLock = this.syncLock
            .then(() => this._performSync())
            .catch((error) => {
                this.logger.error(
                    "[KeychainStore] Error syncing to AsyncStorage:",
                    error,
                );
            });
    }

    async flush(): Promise<void> {
        const flushPromise = this.syncLock.then(() => this._performSync());
        this.syncLock = flushPromise.catch(() => undefined);
        return flushPromise;
    }
}

export const createKeychainSyncedStorage = (
    options: KeychainStorageOptions = {},
): {
    store: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
        setItemAsync: (key: string, value: string) => Promise<void>;
        removeItem: (key: string) => void;
        flush: () => Promise<void>;
    };
    load: () => Promise<void>;
    setEnableBiometrics: (enabled: boolean) => Promise<void>;
    getBiometricsEnabled: () => boolean;
    registerCustomData: (config: CustomDataRegistration) => CustomDataAccessor;
} => {
    const store = new KeychainSyncedStore(options);

    return {
        store: {
            getItem: store.getItem.bind(store),
            setItem: store.setItem.bind(store),
            setItemAsync: store.setItemAsync.bind(store),
            removeItem: store.removeItem.bind(store),
            flush: store.flush.bind(store),
        },
        load: () => store.initialize(),
        setEnableBiometrics: (enabled: boolean) =>
            store.setEnableBiometrics(enabled),
        getBiometricsEnabled: () => store.getBiometricsEnabled(),
        registerCustomData: (config: CustomDataRegistration) =>
            store.registerCustomData(config),
    };
};

export const getSupportedBiometryType = Keychain.getSupportedBiometryType;
