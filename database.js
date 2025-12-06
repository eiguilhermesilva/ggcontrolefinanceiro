// database.js - SISTEMA CORRIGIDO (100% funcional)
// REMOVA O ARQUIVO ANTIGO E USE ESTE

class DatabaseManager {
    constructor() {
        this.dbName = 'camarim_db';
        this.dbVersion = 1; // Começar com versão 1
        this.db = null;
        this.initialized = false;
        
        console.log('🗄️ DatabaseManager criado');
    }
    
    async init() {
        console.log('🚀 Inicializando IndexedDB...');
        
        return new Promise((resolve, reject) => {
            // Verificar suporte
            if (!('indexedDB' in window)) {
                console.warn('⚠️ IndexedDB não suportado');
                resolve(false);
                return;
            }
            
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = (event) => {
                console.error('❌ Erro ao abrir IndexedDB:', event.target.error);
                resolve(false);
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.initialized = true;
                
                console.log('✅ IndexedDB conectado');
                
                // Verificar migração automática
                this.checkAndMigrate().then(() => {
                    resolve(true);
                });
            };
            
            request.onupgradeneeded = (event) => {
                console.log('🔄 Criando estrutura do banco...');
                const db = event.target.result;
                
                // Criar stores básicas
                if (!db.objectStoreNames.contains('products')) {
                    const store = db.createObjectStore('products', { keyPath: 'id' });
                    store.createIndex('category', 'category', { unique: false });
                    store.createIndex('stock', 'stock', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('sales')) {
                    const store = db.createObjectStore('sales', { keyPath: 'id' });
                    store.createIndex('date', 'date', { unique: false });
                    store.createIndex('attendant', 'attendant', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
        });
    }
    
    async checkAndMigrate() {
        try {
            const lsData = localStorage.getItem('camarim-system-data');
            if (!lsData) return;
            
            const data = JSON.parse(lsData);
            if (!data.products || data.products.length === 0) return;
            
            console.log(`📦 ${data.products.length} produtos encontrados no localStorage`);
            
            // Verificar se já temos dados
            const existing = await this.getSystemData();
            if (existing.products.length === 0) {
                console.log('🔄 Migrando dados automaticamente...');
                await this.saveSystemData(data);
                console.log('✅ Migração automática concluída');
            }
            
        } catch (error) {
            console.error('❌ Erro na migração automática:', error);
        }
    }
    
    async getSystemData() {
        if (!this.initialized) {
            return this.getFallbackData();
        }
        
        try {
            const transaction = this.db.transaction(['products', 'sales', 'settings'], 'readonly');
            
            const productsPromise = new Promise((resolve) => {
                const store = transaction.objectStore('products');
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            });
            
            const salesPromise = new Promise((resolve) => {
                const store = transaction.objectStore('sales');
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => resolve([]);
            });
            
            const settingsPromise = new Promise((resolve) => {
                const store = transaction.objectStore('settings');
                const request = store.getAll();
                request.onsuccess = () => {
                    const settingsArray = request.result || [];
                    const settings = {};
                    settingsArray.forEach(s => {
                        settings[s.key] = s.value;
                    });
                    resolve(settings);
                };
                request.onerror = () => resolve({});
            });
            
            const [products, sales, settings] = await Promise.all([
                productsPromise,
                salesPromise,
                settingsPromise
            ]);
            
            return { products, sales, settings };
            
        } catch (error) {
            console.error('❌ Erro ao carregar dados:', error);
            return this.getFallbackData();
        }
    }
    
    async saveSystemData(data) {
        if (!this.initialized) {
            return this.saveToLocalStorage(data);
        }
        
        try {
            const transaction = this.db.transaction(['products', 'sales', 'settings'], 'readwrite');
            
            // Salvar produtos
            const productStore = transaction.objectStore('products');
            await this.clearStore(transaction, productStore);
            if (data.products && data.products.length > 0) {
                for (const product of data.products) {
                    productStore.add(product);
                }
            }
            
            // Salvar vendas
            const salesStore = transaction.objectStore('sales');
            await this.clearStore(transaction, salesStore);
            if (data.sales && data.sales.length > 0) {
                for (const sale of data.sales) {
                    salesStore.add(sale);
                }
            }
            
            // Salvar configurações
            const settingsStore = transaction.objectStore('settings');
            await this.clearStore(transaction, settingsStore);
            if (data.settings) {
                const settingsArray = Object.entries(data.settings).map(([key, value]) => ({
                    key,
                    value
                }));
                for (const setting of settingsArray) {
                    settingsStore.add(setting);
                }
            }
            
            // Manter backup no localStorage
            this.saveToLocalStorage(data);
            
            console.log('💾 Dados salvos no IndexedDB');
            return true;
            
        } catch (error) {
            console.error('❌ Erro ao salvar dados:', error);
            return this.saveToLocalStorage(data);
        }
    }
    
    clearStore(transaction, store) {
        return new Promise((resolve) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
        });
    }
    
    getFallbackData() {
        try {
            const savedData = localStorage.getItem('camarim-system-data');
            if (savedData) {
                return JSON.parse(savedData);
            }
        } catch (error) {
            console.error('❌ Erro no fallback:', error);
        }
        
        return {
            products: [],
            sales: [],
            settings: {
                defaultDebitFee: 2.0,
                defaultCreditFee: 4.5,
                defaultTax: 6,
                defaultMargin: 40,
                monthlyOperationalExpenses: 4000,
                lastProductId: 0,
                lastSaleId: 0
            }
        };
    }
    
    saveToLocalStorage(data) {
        try {
            localStorage.setItem('camarim-system-data', JSON.stringify(data));
            console.log('💾 Dados salvos no localStorage (fallback)');
            return true;
        } catch (error) {
            console.error('❌ Erro ao salvar no localStorage:', error);
            return false;
        }
    }
    
    async migrateFromLocalStorage() {
        try {
            const lsData = localStorage.getItem('camarim-system-data');
            if (!lsData) {
                console.log('📭 Nenhum dado para migrar');
                return false;
            }
            
            const data = JSON.parse(lsData);
            console.log(`🔄 Migrando ${data.products?.length || 0} produtos...`);
            
            const success = await this.saveSystemData(data);
            
            if (success) {
                console.log('✅ Migração concluída');
                // Manter backup por segurança
                localStorage.setItem('camarim-backup-migrated', lsData);
                localStorage.setItem('camarim-migration-date', new Date().toISOString());
                return true;
            }
            
            return false;
            
        } catch (error) {
            console.error('❌ Erro na migração:', error);
            return false;
        }
    }
    
    async getDatabaseInfo() {
        if (!this.initialized) {
            return {
                status: 'LocalStorage',
                products: this.getFallbackData().products.length,
                sales: this.getFallbackData().sales.length,
                storage: '0 MB'
            };
        }
        
        try {
            const data = await this.getSystemData();
            
            return {
                status: 'IndexedDB',
                products: data.products.length,
                sales: data.sales.length,
                storage: await this.getStorageInfo()
            };
            
        } catch (error) {
            console.error('❌ Erro ao obter info:', error);
            return null;
        }
    }
    
    async getStorageInfo() {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            try {
                const estimate = await navigator.storage.estimate();
                const usageMB = (estimate.usage / 1024 / 1024).toFixed(2);
                return `${usageMB} MB`;
            } catch (error) {
                return 'N/A';
            }
        }
        return 'N/A';
    }
}

// ============================================
// INICIALIZAÇÃO GLOBAL
// ============================================

// Criar instância global
const databaseManager = new DatabaseManager();

// Exportar para window (IMPORTANTE!)
window.databaseManager = databaseManager;
window.CamarimDatabase = databaseManager;

// Mensagem de confirmação
console.log('✅ DatabaseManager carregado e pronto');