// database.js - Sistema de Gerenciamento de Banco de Dados IndexedDB para Camarim
class DatabaseManager {
    constructor() {
        this.dbName = 'camarim_db';
        this.dbVersion = 3;
        this.db = null;
        this.initialized = false;
        
        this.stores = {
            PRODUCTS: 'products',
            SALES: 'sales',
            SETTINGS: 'settings',
            BACKUPS: 'backups',
            AUDIT_LOG: 'audit_log'
        };
        
        this.monitor = new DatabaseMonitor();
        this.queryCache = new QueryCache();
        this.backgroundSync = new BackgroundSync();
    }
    
    // ============================================
    // INICIALIZAÇÃO DO BANCO
    // ============================================
    
    async init() {
        console.log('🚀 Inicializando IndexedDB...');
        this.monitor.logEvent('db_init_start');
        
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) {
                console.warn('⚠️ IndexedDB não suportado. Usando localStorage como fallback.');
                this.monitor.logError('indexeddb_not_supported');
                resolve(false);
                return;
            }
            
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = (event) => {
                const error = event.target.error;
                console.error('❌ Erro ao abrir IndexedDB:', error);
                this.monitor.logError('db_open_error', error.message);
                resolve(false);
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.initialized = true;
                
                // Configurar handlers de erro
                this.db.onerror = (event) => {
                    console.error('❌ Erro no banco de dados:', event.target.error);
                    this.monitor.logError('db_runtime_error', event.target.error.message);
                };
                
                console.log('✅ IndexedDB conectado com sucesso');
                this.monitor.logEvent('db_init_success');
                
                // Iniciar migração automática
                this.migrateFromLocalStorage().then(() => {
                    // Iniciar sincronização em background
                    this.backgroundSync.start();
                    resolve(true);
                });
            };
            
            request.onupgradeneeded = (event) => {
                console.log('🔄 Atualizando schema do IndexedDB...');
                const db = event.target.result;
                const oldVersion = event.oldVersion || 0;
                
                // Migração do schema
                this.createOrUpdateStores(db, oldVersion);
                this.monitor.logEvent('db_schema_upgraded', { oldVersion, newVersion: this.dbVersion });
            };
        });
    }
    
    createOrUpdateStores(db, oldVersion) {
        // Criar store de produtos
        if (!db.objectStoreNames.contains(this.stores.PRODUCTS)) {
            const productsStore = db.createObjectStore(this.stores.PRODUCTS, { 
                keyPath: 'id' 
            });
            productsStore.createIndex('category', 'category', { unique: false });
            productsStore.createIndex('stock', 'stock', { unique: false });
            productsStore.createIndex('createdAt', 'createdAt', { unique: false });
            console.log('📦 Store "products" criada');
        }
        
        // Criar store de vendas
        if (!db.objectStoreNames.contains(this.stores.SALES)) {
            const salesStore = db.createObjectStore(this.stores.SALES, { 
                keyPath: 'id' 
            });
            salesStore.createIndex('date', 'date', { unique: false });
            salesStore.createIndex('attendant', 'attendant', { unique: false });
            salesStore.createIndex('total', 'total', { unique: false });
            salesStore.createIndex('paymentMethod', 'paymentMethod', { unique: false });
            console.log('💰 Store "sales" criada');
        }
        
        // Criar store de configurações
        if (!db.objectStoreNames.contains(this.stores.SETTINGS)) {
            db.createObjectStore(this.stores.SETTINGS, { 
                keyPath: 'key' 
            });
            console.log('⚙️ Store "settings" criada');
        }
        
        // Criar store de backups
        if (!db.objectStoreNames.contains(this.stores.BACKUPS)) {
            const backupsStore = db.createObjectStore(this.stores.BACKUPS, { 
                keyPath: 'timestamp' 
            });
            backupsStore.createIndex('type', 'type', { unique: false });
            console.log('💾 Store "backups" criada');
        }
        
        // Criar store de logs de auditoria (versão 3)
        if (oldVersion < 3 && !db.objectStoreNames.contains(this.stores.AUDIT_LOG)) {
            const auditStore = db.createObjectStore(this.stores.AUDIT_LOG, { 
                keyPath: 'id',
                autoIncrement: true 
            });
            auditStore.createIndex('timestamp', 'timestamp', { unique: false });
            auditStore.createIndex('action', 'action', { unique: false });
            auditStore.createIndex('userId', 'userId', { unique: false });
            console.log('📝 Store "audit_log" criada');
        }
        
        // Atualizar índices existentes se necessário
        if (oldVersion > 0) {
            this.updateExistingStores(db, oldVersion);
        }
    }
    
    updateExistingStores(db, oldVersion) {
        // Adicionar novos índices em versões futuras
        if (oldVersion < 2) {
            const transaction = db.transaction([this.stores.PRODUCTS], 'readwrite');
            const store = transaction.objectStore(this.stores.PRODUCTS);
            
            if (!store.indexNames.contains('sellingPrice')) {
                store.createIndex('sellingPrice', 'sellingPrice', { unique: false });
                console.log('📊 Índice "sellingPrice" adicionado aos produtos');
            }
        }
    }
    
    // ============================================
    // MIGRAÇÃO DO LOCALSTORAGE
    // ============================================
    
    async migrateFromLocalStorage() {
        try {
            const localStorageData = localStorage.getItem('camarim-system-data');
            
            if (!localStorageData) {
                console.log('📭 Nenhum dado no localStorage para migrar');
                return;
            }
            
            const data = JSON.parse(localStorageData);
            
            await this.logAudit('migration_start', {
                source: 'localStorage',
                itemsCount: {
                    products: data.products?.length || 0,
                    sales: data.sales?.length || 0
                }
            });
            
            console.log('🔄 Iniciando migração do localStorage...');
            
            // Verificar se já existem dados no IndexedDB
            const existingProducts = await this.getStoreCount(this.stores.PRODUCTS);
            const existingSales = await this.getStoreCount(this.stores.SALES);
            
            if (existingProducts > 0 || existingSales > 0) {
                console.log('ℹ️ Dados já existem no IndexedDB, mesclando...');
                await this.mergeData(data);
            } else {
                console.log('🆕 Migrando dados do localStorage para IndexedDB vazio...');
                await this.saveSystemData(data);
            }
            
            // Criar backup da migração
            await this.createBackup('migration', data);
            
            // Marcar como migrado (manter backup por segurança)
            localStorage.setItem('camarim-migrated-date', new Date().toISOString());
            localStorage.setItem('camarim-backup-data', localStorageData);
            
            await this.logAudit('migration_complete', {
                migratedItems: {
                    products: data.products?.length || 0,
                    sales: data.sales?.length || 0
                }
            });
            
            console.log(`✅ Migração concluída: ${data.products?.length || 0} produtos, ${data.sales?.length || 0} vendas`);
            
        } catch (error) {
            console.error('❌ Erro na migração:', error);
            await this.logAudit('migration_error', { 
                error: error.message,
                stack: error.stack 
            });
        }
    }
    
    async mergeData(data) {
        try {
            // Mesclar produtos (evitar duplicados por ID)
            if (data.products && data.products.length > 0) {
                const existingProducts = await this.getAll(this.stores.PRODUCTS);
                const existingIds = new Set(existingProducts.map(p => p.id));
                
                const newProducts = data.products.filter(p => !existingIds.has(p.id));
                
                if (newProducts.length > 0) {
                    await this.bulkAdd(this.stores.PRODUCTS, newProducts);
                    console.log(`➕ ${newProducts.length} novos produtos adicionados`);
                }
            }
            
            // Mesclar vendas (pode ter duplicados se IDs forem diferentes)
            if (data.sales && data.sales.length > 0) {
                const existingSales = await this.getAll(this.stores.SALES);
                const existingIds = new Set(existingSales.map(s => s.id));
                
                const newSales = data.sales.filter(s => !existingIds.has(s.id));
                
                if (newSales.length > 0) {
                    await this.bulkAdd(this.stores.SALES, newSales);
                    console.log(`➕ ${newSales.length} novas vendas adicionadas`);
                }
            }
            
        } catch (error) {
            console.error('❌ Erro ao mesclar dados:', error);
            throw error;
        }
    }
    
    // ============================================
    // OPERAÇÕES CRUD BÁSICAS (COM CACHE)
    // ============================================
    
    async add(storeName, data) {
        this.monitor.logQuery();
        
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database não inicializada'));
                return;
            }
            
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            const request = store.add(data);
            
            request.onsuccess = () => {
                // Invalidar cache
                this.queryCache.invalidatePattern(storeName);
                
                // Log da ação
                this.logAudit('add', { 
                    store: storeName, 
                    id: data.id || data.key 
                });
                
                this.monitor.logEvent('add_success', { store: storeName });
                resolve(request.result);
            };
            
            request.onerror = (event) => {
                this.monitor.logError('add_error', event.target.error.message);
                reject(event.target.error);
            };
        });
    }
    
    async get(storeName, key) {
        this.monitor.logQuery();
        const cacheKey = `${storeName}_${key}`;
        
        return this.queryCache.getOrFetch(cacheKey, () => {
            return new Promise((resolve, reject) => {
                if (!this.db) {
                    reject(new Error('Database não inicializada'));
                    return;
                }
                
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                
                const request = store.get(key);
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = (event) => {
                    this.monitor.logError('get_error', event.target.error.message);
                    reject(event.target.error);
                };
            });
        });
    }
    
    async getAll(storeName, indexName = null, range = null) {
        this.monitor.logQuery();
        const cacheKey = `${storeName}_all_${indexName}_${range?.lower || ''}_${range?.upper || ''}`;
        
        return this.queryCache.getOrFetch(cacheKey, () => {
            return new Promise((resolve, reject) => {
                if (!this.db) {
                    reject(new Error('Database não inicializada'));
                    return;
                }
                
                const transaction = this.db.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const source = indexName ? store.index(indexName) : store;
                
                const request = range ? source.getAll(range) : source.getAll();
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = (event) => {
                    this.monitor.logError('get_all_error', event.target.error.message);
                    reject(event.target.error);
                };
            });
        });
    }
    
    async update(storeName, data) {
        this.monitor.logQuery();
        
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database não inicializada'));
                return;
            }
            
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            const request = store.put(data);
            
            request.onsuccess = () => {
                // Invalidar cache
                this.queryCache.invalidatePattern(storeName);
                
                this.logAudit('update', { 
                    store: storeName, 
                    id: data.id || data.key 
                });
                
                this.monitor.logEvent('update_success', { store: storeName });
                resolve(request.result);
            };
            
            request.onerror = (event) => {
                this.monitor.logError('update_error', event.target.error.message);
                reject(event.target.error);
            };
        });
    }
    
    async delete(storeName, key) {
        this.monitor.logQuery();
        
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database não inicializada'));
                return;
            }
            
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            const request = store.delete(key);
            
            request.onsuccess = () => {
                // Invalidar cache
                this.queryCache.invalidatePattern(storeName);
                
                this.logAudit('delete', { 
                    store: storeName, 
                    id: key 
                });
                
                this.monitor.logEvent('delete_success', { store: storeName });
                resolve(true);
            };
            
            request.onerror = (event) => {
                this.monitor.logError('delete_error', event.target.error.message);
                reject(event.target.error);
            };
        });
    }
    
    async bulkAdd(storeName, items) {
        this.monitor.logQuery();
        
        return new Promise((resolve, reject) => {
            if (!this.db || !items || items.length === 0) {
                resolve(0);
                return;
            }
            
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            let completed = 0;
            let errors = [];
            
            transaction.oncomplete = () => {
                // Invalidar cache após transação completa
                this.queryCache.invalidatePattern(storeName);
                
                if (errors.length > 0) {
                    this.monitor.logError('bulk_add_partial', 
                        `${errors.length} erros em ${items.length} itens`);
                    reject(new Error(`${errors.length} erros em ${items.length} itens`));
                } else {
                    this.monitor.logEvent('bulk_add_success', { 
                        store: storeName, 
                        count: completed 
                    });
                    resolve(completed);
                }
            };
            
            transaction.onerror = (event) => {
                this.monitor.logError('bulk_add_transaction_error', event.target.error.message);
                reject(event.target.error);
            };
            
            items.forEach(item => {
                const request = store.add(item);
                
                request.onsuccess = () => {
                    completed++;
                };
                
                request.onerror = (event) => {
                    errors.push({
                        item: item.id || item.key,
                        error: event.target.error
                    });
                };
            });
        });
    }
    
    // ============================================
    // OPERAÇÕES ESPECÍFICAS DO SISTEMA
    // ============================================
    
    async getSystemData() {
        this.monitor.logQuery();
        
        try {
            const [products, sales, settingsArray] = await Promise.all([
                this.getAll(this.stores.PRODUCTS),
                this.getAll(this.stores.SALES),
                this.getAll(this.stores.SETTINGS)
            ]);
            
            // Converter array de settings para objeto
            const settings = {};
            if (settingsArray) {
                settingsArray.forEach(setting => {
                    settings[setting.key] = setting.value;
                });
            }
            
            return {
                products: products || [],
                sales: sales || [],
                settings: settings
            };
            
        } catch (error) {
            console.error('❌ Erro ao carregar dados do sistema:', error);
            this.monitor.logError('get_system_data_error', error.message);
            
            // Fallback para localStorage se houver erro
            return this.getFallbackData();
        }
    }
    
    async saveSystemData(data) {
        this.monitor.logQuery();
        
        try {
            // Usar transação única para atomicidade
            await this.executeTransaction(async () => {
                // Salvar produtos
                if (data.products && data.products.length > 0) {
                    await this.clearStore(this.stores.PRODUCTS);
                    await this.bulkAdd(this.stores.PRODUCTS, data.products);
                }
                
                // Salvar vendas
                if (data.sales && data.sales.length > 0) {
                    await this.clearStore(this.stores.SALES);
                    await this.bulkAdd(this.stores.SALES, data.sales);
                }
                
                // Salvar configurações
                if (data.settings) {
                    await this.clearStore(this.stores.SETTINGS);
                    const settingsArray = Object.entries(data.settings).map(([key, value]) => ({
                        key,
                        value
                    }));
                    await this.bulkAdd(this.stores.SETTINGS, settingsArray);
                }
            });
            
            // Criar backup automático
            await this.createBackup('auto', data);
            
            // Manter cópia no localStorage como backup (temporário)
            localStorage.setItem('camarim-backup-latest', JSON.stringify(data));
            localStorage.setItem('camarim-last-save', new Date().toISOString());
            
            this.monitor.logEvent('system_data_saved', {
                products: data.products?.length || 0,
                sales: data.sales?.length || 0
            });
            
            return true;
            
        } catch (error) {
            console.error('❌ Erro ao salvar dados do sistema:', error);
            this.monitor.logError('save_system_data_error', error.message);
            
            // Fallback para localStorage
            return this.saveToLocalStorageFallback(data);
        }
    }
    
    async executeTransaction(operations) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database não inicializada'));
                return;
            }
            
            const storeNames = [
                this.stores.PRODUCTS,
                this.stores.SALES,
                this.stores.SETTINGS
            ];
            
            const transaction = this.db.transaction(storeNames, 'readwrite');
            
            transaction.oncomplete = () => {
                resolve();
            };
            
            transaction.onerror = (event) => {
                reject(event.target.error);
            };
            
            // Executar operações dentro da transação
            operations().catch(error => {
                transaction.abort();
                reject(error);
            });
        });
    }
    
    getFallbackData() {
        try {
            const localStorageData = localStorage.getItem('camarim-system-data');
            if (localStorageData) {
                console.log('🔄 Usando dados do localStorage como fallback');
                return JSON.parse(localStorageData);
            }
        } catch (error) {
            console.error('❌ Erro ao carregar fallback:', error);
        }
        
        return {
            products: [],
            sales: [],
            settings: this.getDefaultSettings()
        };
    }
    
    saveToLocalStorageFallback(data) {
        try {
            localStorage.setItem('camarim-system-data', JSON.stringify(data));
            console.log('📝 Dados salvos no localStorage (fallback)');
            return true;
        } catch (error) {
            console.error('❌ Erro ao salvar no localStorage:', error);
            return false;
        }
    }
    
    getDefaultSettings() {
        return {
            defaultDebitFee: 2.0,
            defaultCreditFee: 4.5,
            defaultTax: 6,
            defaultMargin: 40,
            monthlyOperationalExpenses: 4000,
            lastProductId: 0,
            lastSaleId: 0
        };
    }
    
    // ============================================
    // BACKUP E RESTAURAÇÃO
    // ============================================
    
    async createBackup(type = 'manual', data = null) {
        try {
            const timestamp = new Date().toISOString();
            
            if (!data) {
                data = await this.getSystemData();
            }
            
            const backup = {
                timestamp,
                type,
                data,
                version: this.dbVersion,
                info: await this.getDatabaseInfo()
            };
            
            await this.add(this.stores.BACKUPS, backup);
            
            // Manter apenas últimos 30 backups
            await this.cleanupOldBackups(30);
            
            console.log(`💾 Backup criado: ${timestamp} (${type})`);
            this.monitor.logEvent('backup_created', { type });
            
            return timestamp;
            
        } catch (error) {
            console.error('❌ Erro ao criar backup:', error);
            this.monitor.logError('backup_error', error.message);
            return null;
        }
    }
    
    async cleanupOldBackups(maxBackups = 30) {
        try {
            const backups = await this.getAll(this.stores.BACKUPS);
            
            if (backups.length > maxBackups) {
                // Ordenar por timestamp (mais antigos primeiro)
                backups.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                
                // Remover os mais antigos
                const toRemove = backups.slice(0, backups.length - maxBackups);
                
                for (const backup of toRemove) {
                    await this.delete(this.stores.BACKUPS, backup.timestamp);
                }
                
                console.log(`🗑️ ${toRemove.length} backups antigos removidos`);
                this.monitor.logEvent('backups_cleaned', { count: toRemove.length });
            }
            
        } catch (error) {
            console.error('❌ Erro ao limpar backups:', error);
        }
    }
    
    async restoreBackup(timestamp) {
        try {
            const backup = await this.get(this.stores.BACKUPS, timestamp);
            
            if (!backup) {
                throw new Error('Backup não encontrado');
            }
            
            // Criar backup antes da restauração
            await this.createBackup('pre_restore');
            
            // Restaurar dados
            await this.saveSystemData(backup.data);
            
            await this.logAudit('restore_backup', { timestamp });
            
            console.log(`✅ Backup ${timestamp} restaurado com sucesso`);
            this.monitor.logEvent('backup_restored', { timestamp });
            
            return true;
            
        } catch (error) {
            console.error('❌ Erro ao restaurar backup:', error);
            this.monitor.logError('restore_error', error.message);
            return false;
        }
    }
    
    async getBackups(type = null) {
        try {
            let backups = await this.getAll(this.stores.BACKUPS);
            
            // Filtrar por tipo se especificado
            if (type) {
                backups = backups.filter(backup => backup.type === type);
            }
            
            // Ordenar por timestamp (mais recente primeiro)
            backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            return backups;
            
        } catch (error) {
            console.error('❌ Erro ao obter backups:', error);
            return [];
        }
    }
    
    // ============================================
    // AUDIT LOG
    // ============================================
    
    async logAudit(action, details = {}) {
        try {
            if (!this.db || !this.db.objectStoreNames.contains(this.stores.AUDIT_LOG)) {
                return; // Store de audit não disponível
            }
            
            const userId = window.externalLoginSystem?.getUserId?.() || 'unknown';
            const userName = window.externalLoginSystem?.getUserName?.() || 'Sistema';
            
            const logEntry = {
                timestamp: new Date().toISOString(),
                action,
                details: JSON.stringify(details),
                userId,
                userName,
                userAgent: navigator.userAgent.substring(0, 200),
                url: window.location.href
            };
            
            await this.add(this.stores.AUDIT_LOG, logEntry);
            
        } catch (error) {
            console.error('❌ Erro ao registrar log de auditoria:', error);
        }
    }
    
    async getAuditLogs(limit = 100, filters = {}) {
        try {
            let logs = await this.getAll(this.stores.AUDIT_LOG);
            
            // Aplicar filtros
            if (filters.action) {
                logs = logs.filter(log => log.action === filters.action);
            }
            
            if (filters.userId) {
                logs = logs.filter(log => log.userId === filters.userId);
            }
            
            if (filters.startDate) {
                logs = logs.filter(log => new Date(log.timestamp) >= new Date(filters.startDate));
            }
            
            if (filters.endDate) {
                logs = logs.filter(log => new Date(log.timestamp) <= new Date(filters.endDate));
            }
            
            // Ordenar por timestamp (mais recente primeiro)
            logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            return logs.slice(0, limit);
            
        } catch (error) {
            console.error('❌ Erro ao obter logs de auditoria:', error);
            return [];
        }
    }
    
    // ============================================
    // UTILITÁRIOS
    // ============================================
    
    async clearStore(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database não inicializada'));
                return;
            }
            
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            const request = store.clear();
            
            request.onsuccess = () => {
                this.queryCache.invalidatePattern(storeName);
                resolve(true);
            };
            
            request.onerror = (event) => reject(event.target.error);
        });
    }
    
    async getStoreCount(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.db) {
                reject(new Error('Database não inicializada'));
                return;
            }
            
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            
            const request = store.count();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }
    
    async getDatabaseInfo() {
        try {
            if (!this.db) {
                return null;
            }
            
            const [productsCount, salesCount, backupsCount, auditCount, settingsCount] = await Promise.all([
                this.getStoreCount(this.stores.PRODUCTS),
                this.getStoreCount(this.stores.SALES),
                this.getStoreCount(this.stores.BACKUPS),
                this.getStoreCount(this.stores.AUDIT_LOG),
                this.getStoreCount(this.stores.SETTINGS)
            ]);
            
            const storageEstimate = await this.estimateStorage();
            
            return {
                name: this.dbName,
                version: this.dbVersion,
                stores: Array.from(this.db.objectStoreNames),
                counts: {
                    products: productsCount,
                    sales: salesCount,
                    backups: backupsCount,
                    audit_log: auditCount,
                    settings: settingsCount
                },
                storageEstimate,
                initialized: this.initialized,
                lastBackup: await this.getLastBackupDate(),
                metrics: this.monitor.getMetrics()
            };
            
        } catch (error) {
            console.error('❌ Erro ao obter informações do banco:', error);
            return null;
        }
    }
    
    async getLastBackupDate() {
        try {
            const backups = await this.getBackups();
            return backups.length > 0 ? backups[0].timestamp : null;
        } catch {
            return null;
        }
    }
    
    async estimateStorage() {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            try {
                const estimate = await navigator.storage.estimate();
                return {
                    usage: estimate.usage,
                    quota: estimate.quota,
                    percentage: estimate.quota ? 
                        (estimate.usage / estimate.quota * 100).toFixed(2) : 0,
                    usageMB: (estimate.usage / 1024 / 1024).toFixed(2),
                    quotaMB: (estimate.quota / 1024 / 1024).toFixed(2)
                };
            } catch (error) {
                console.error('❌ Erro ao estimar storage:', error);
                return null;
            }
        }
        return null;
    }
    
    async exportDatabase(format = 'json') {
        try {
            const data = await this.getSystemData();
            const info = await this.getDatabaseInfo();
            
            const exportData = {
                metadata: {
                    exportDate: new Date().toISOString(),
                    version: this.dbVersion,
                    system: 'Camarim DB Export',
                    format: format
                },
                info,
                data
            };
            
            if (format === 'json') {
                return JSON.stringify(exportData, null, 2);
            } else {
                // Para outros formatos futuros (CSV, Excel)
                throw new Error('Formato não suportado');
            }
            
        } catch (error) {
            console.error('❌ Erro ao exportar banco:', error);
            throw error;
        }
    }
    
    async importDatabase(importData) {
        try {
            // Validar estrutura
            if (!importData.data || !importData.metadata) {
                throw new Error('Dados de importação inválidos');
            }
            
            await this.logAudit('import_start', {
                source: importData.metadata.system || 'file',
                items: {
                    products: importData.data.products?.length || 0,
                    sales: importData.data.sales?.length || 0
                }
            });
            
            // Criar backup antes da importação
            await this.createBackup('pre_import');
            
            // Limpar dados existentes
            await Promise.all([
                this.clearStore(this.stores.PRODUCTS),
                this.clearStore(this.stores.SALES),
                this.clearStore(this.stores.SETTINGS)
            ]);
            
            // Importar novos dados
            await this.saveSystemData(importData.data);
            
            await this.logAudit('import_complete', {
                importedItems: {
                    products: importData.data.products?.length || 0,
                    sales: importData.data.sales?.length || 0
                }
            });
            
            console.log('✅ Importação concluída com sucesso');
            this.monitor.logEvent('import_success', {
                products: importData.data.products?.length || 0,
                sales: importData.data.sales?.length || 0
            });
            
            return true;
            
        } catch (error) {
            console.error('❌ Erro ao importar banco:', error);
            await this.logAudit('import_error', { error: error.message });
            this.monitor.logError('import_error', error.message);
            throw error;
        }
    }
    
    // ============================================
    // CONSULTAS AVANÇADAS
    // ============================================
    
    async searchProducts(query, field = 'name') {
        try {
            const products = await this.getAll(this.stores.PRODUCTS);
            
            return products.filter(product => {
                const value = product[field];
                if (!value) return false;
                
                return value.toString().toLowerCase().includes(query.toLowerCase());
            });
            
        } catch (error) {
            console.error('❌ Erro na busca de produtos:', error);
            return [];
        }
    }
    
    async getSalesByDateRange(startDate, endDate) {
        try {
            const range = IDBKeyRange.bound(startDate, endDate);
            return await this.getAll(this.stores.SALES, 'date', range);
        } catch (error) {
            console.error('❌ Erro ao obter vendas por data:', error);
            return [];
        }
    }
    
    async getLowStockProducts(threshold = 10) {
        try {
            const products = await this.getAll(this.stores.PRODUCTS);
            return products.filter(p => p.stock < threshold);
        } catch (error) {
            console.error('❌ Erro ao obter produtos com baixo estoque:', error);
            return [];
        }
    }
    
    async getTopSellingProducts(limit = 10, period = 'all') {
        try {
            const sales = await this.getAll(this.stores.SALES);
            const productSales = {};
            
            // Filtrar por período se necessário
            let filteredSales = sales;
            if (period !== 'all') {
                const now = new Date();
                let startDate;
                
                switch (period) {
                    case 'today':
                        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                        break;
                    case 'week':
                        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
                        break;
                    case 'month':
                        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                        break;
                    default:
                        startDate = new Date(0); // Todas as vendas
                }
                
                filteredSales = sales.filter(sale => new Date(sale.date) >= startDate);
            }
            
            // Contar vendas por produto
            filteredSales.forEach(sale => {
                sale.items.forEach(item => {
                    if (!productSales[item.productId]) {
                        productSales[item.productId] = {
                            productId: item.productId,
                            name: item.name,
                            quantity: 0,
                            revenue: 0
                        };
                    }
                    
                    productSales[item.productId].quantity += item.quantity;
                    productSales[item.productId].revenue += item.quantity * item.price;
                });
            });
            
            // Converter para array e ordenar
            const topProducts = Object.values(productSales)
                .sort((a, b) => b.quantity - a.quantity)
                .slice(0, limit);
            
            return topProducts;
            
        } catch (error) {
            console.error('❌ Erro ao obter produtos mais vendidos:', error);
            return [];
        }
    }
    
    // ============================================
    // MANUTENÇÃO
    // ============================================
    
    async compactDatabase() {
        try {
            console.log('🔄 Compactando banco de dados...');
            
            // Criar backup antes da compactação
            await this.createBackup('pre_compact');
            
            // Exportar dados
            const exportData = await this.exportDatabase('json');
            const parsedData = JSON.parse(exportData);
            
            // Limpar banco
            await Promise.all([
                this.clearStore(this.stores.PRODUCTS),
                this.clearStore(this.stores.SALES),
                this.clearStore(this.stores.SETTINGS),
                this.clearStore(this.stores.BACKUPS),
                this.clearStore(this.stores.AUDIT_LOG)
            ]);
            
            // Importar dados novamente (compacta os registros)
            await this.importDatabase(parsedData);
            
            // Limpar cache
            this.queryCache.clear();
            
            console.log('✅ Banco compactado com sucesso');
            this.monitor.logEvent('db_compacted');
            
            return true;
            
        } catch (error) {
            console.error('❌ Erro ao compactar banco:', error);
            return false;
        }
    }
    
    async rebuildIndexes() {
        try {
            console.log('🔄 Reconstruindo índices...');
            
            // Fechar conexão atual
            if (this.db) {
                this.db.close();
            }
            
            // Reabrir com versão aumentada para forçar reconstrução
            this.dbVersion++;
            await this.init();
            
            console.log('✅ Índices reconstruídos');
            return true;
            
        } catch (error) {
            console.error('❌ Erro ao reconstruir índices:', error);
            return false;
        }
    }
    
    // ============================================
    // DESTRUIDOR
    // ============================================
    
    async destroy() {
        try {
            if (this.db) {
                this.db.close();
            }
            
            // Limpar cache
            this.queryCache.clear();
            
            // Parar sincronização em background
            this.backgroundSync.stop();
            
            this.db = null;
            this.initialized = false;
            
            console.log('🔌 Conexão com o banco fechada');
            this.monitor.logEvent('db_destroyed');
            
        } catch (error) {
            console.error('❌ Erro ao destruir banco:', error);
        }
    }
    
    async deleteDatabase() {
        try {
            await this.destroy();
            
            return new Promise((resolve, reject) => {
                const request = indexedDB.deleteDatabase(this.dbName);
                
                request.onsuccess = () => {
                    console.log('🗑️ Banco de dados excluído');
                    this.monitor.logEvent('db_deleted');
                    resolve(true);
                };
                
                request.onerror = (event) => {
                    console.error('❌ Erro ao excluir banco:', event.target.error);
                    reject(event.target.error);
                };
            });
            
        } catch (error) {
            console.error('❌ Erro ao excluir banco:', error);
            throw error;
        }
    }
}

// ============================================
// CLASSES AUXILIARES
// ============================================

class DatabaseMonitor {
    constructor() {
        this.metrics = {
            queries: 0,
            errors: 0,
            cacheHits: 0,
            cacheMisses: 0,
            events: {},
            startTime: Date.now()
        };
    }
    
    logQuery() {
        this.metrics.queries++;
    }
    
    logError(type, message = '') {
        this.metrics.errors++;
        
        if (!this.metrics.events[type]) {
            this.metrics.events[type] = 0;
        }
        this.metrics.events[type]++;
        
        // Opcional: enviar para serviço de logging
        if (window.console && console.error) {
            console.error(`[DB Error] ${type}: ${message}`);
        }
    }
    
    logEvent(type, data = {}) {
        if (!this.metrics.events[type]) {
            this.metrics.events[type] = 0;
        }
        this.metrics.events[type]++;
    }
    
    logCacheHit() {
        this.metrics.cacheHits++;
    }
    
    logCacheMiss() {
        this.metrics.cacheMisses++;
    }
    
    getMetrics() {
        const uptime = Date.now() - this.metrics.startTime;
        const hours = (uptime / (1000 * 60 * 60)).toFixed(2);
        
        return {
            queries: this.metrics.queries,
            errors: this.metrics.errors,
            cacheHits: this.metrics.cacheHits,
            cacheMisses: this.metrics.cacheMisses,
            cacheHitRate: this.metrics.cacheHits + this.metrics.cacheMisses > 0 ? 
                (this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses) * 100).toFixed(2) + '%' : 
                '0%',
            errorRate: this.metrics.queries > 0 ? 
                (this.metrics.errors / this.metrics.queries * 100).toFixed(2) + '%' : 
                '0%',
            uptime: `${hours}h`,
            events: this.metrics.events
        };
    }
    
    showMetrics() {
        const metrics = this.getMetrics();
        console.group('📊 Métricas do Banco de Dados');
        console.table(metrics);
        console.groupEnd();
    }
}

class QueryCache {
    constructor() {
        this.cache = new Map();
        this.defaultTTL = 5 * 60 * 1000; // 5 minutos
        this.maxSize = 100; // Máximo de itens em cache
    }
    
    async getOrFetch(key, fetchFunction, ttl = this.defaultTTL) {
        const cached = this.cache.get(key);
        
        if (cached && Date.now() - cached.timestamp < ttl) {
            databaseManager.monitor.logCacheHit();
            return cached.data;
        }
        
        databaseManager.monitor.logCacheMiss();
        const data = await fetchFunction();
        
        // Gerenciar tamanho do cache
        if (this.cache.size >= this.maxSize) {
            this.removeOldest();
        }
        
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
        
        return data;
    }
    
    removeOldest() {
        let oldestKey = null;
        let oldestTime = Infinity;
        
        for (const [key, value] of this.cache.entries()) {
            if (value.timestamp < oldestTime) {
                oldestTime = value.timestamp;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }
    
    invalidate(key) {
        this.cache.delete(key);
    }
    
    invalidatePattern(pattern) {
        for (const key of this.cache.keys()) {
            if (key.includes(pattern)) {
                this.cache.delete(key);
            }
        }
    }
    
    clear() {
        this.cache.clear();
    }
}

class BackgroundSync {
    constructor() {
        this.syncInterval = 5 * 60 * 1000; // 5 minutos
        this.cleanupInterval = 24 * 60 * 60 * 1000; // 24 horas
        this.lastSync = null;
        this.syncInProgress = false;
        this.intervalId = null;
        this.cleanupId = null;
    }
    
    start() {
        console.log('🔄 Iniciando sincronização em background...');
        
        // Sincronizar imediatamente
        this.sync();
        
        // Sincronizar periodicamente
        this.intervalId = setInterval(() => this.sync(), this.syncInterval);
        
        // Limpeza periódica
        this.cleanupId = setInterval(() => this.cleanup(), this.cleanupInterval);
        
        // Sincronizar quando a página for focada
        window.addEventListener('focus', () => this.quickSync());
        
        // Sincronizar antes da página fechar
        window.addEventListener('beforeunload', () => this.quickSync());
        
        // Sincronizar quando voltar online
        window.addEventListener('online', () => this.sync());
    }
    
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        
        if (this.cleanupId) {
            clearInterval(this.cleanupId);
            this.cleanupId = null;
        }
        
        console.log('⏹️ Sincronização em background parada');
    }
    
    async sync() {
        if (this.syncInProgress) return;
        
        this.syncInProgress = true;
        
        try {
            console.log('🔄 Sincronizando dados em background...');
            
            // 1. Verificar integridade dos dados
            await this.checkDataIntegrity();
            
            // 2. Fazer backup incremental (apenas se houver mudanças)
            const hasChanges = await this.hasChangesSinceLastSync();
            if (hasChanges) {
                await databaseManager.createBackup('auto_sync');
            }
            
            // 3. Compactar dados se necessário
            await this.cleanupOldData();
            
            this.lastSync = new Date();
            console.log('✅ Sincronização concluída:', this.lastSync.toLocaleTimeString());
            
            databaseManager.monitor.logEvent('background_sync_complete');
            
        } catch (error) {
            console.error('❌ Erro na sincronização:', error);
            databaseManager.monitor.logError('background_sync_error', error.message);
        } finally {
            this.syncInProgress = false;
        }
    }
    
    async quickSync() {
        // Sincronização rápida para beforeunload ou focus
        try {
            await databaseManager.createBackup('quick_sync');
            databaseManager.monitor.logEvent('quick_sync_complete');
        } catch (error) {
            console.error('❌ Erro no quick sync:', error);
        }
    }
    
    async hasChangesSinceLastSync() {
        try {
            const lastSave = localStorage.getItem('camarim-last-save');
            if (!lastSave || !this.lastSync) return true;
            
            return new Date(lastSave) > this.lastSync;
        } catch {
            return true; // Em caso de dúvida, faz backup
        }
    }
    
    async cleanupOldData() {
        try {
            // Arquivar vendas com mais de 2 anos
            const twoYearsAgo = new Date();
            twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
            
            const oldSales = await databaseManager.getSalesByDateRange(
                new Date(0).toISOString(),
                twoYearsAgo.toISOString()
            );
            
            if (oldSales.length > 0) {
                // Criar backup dos dados antigos
                await databaseManager.createBackup('archive', {
                    products: [],
                    sales: oldSales,
                    settings: {}
                });
                
                // Remover do banco principal
                for (const sale of oldSales) {
                    await databaseManager.delete(databaseManager.stores.SALES, sale.id);
                }
                
                console.log(`🗃️ ${oldSales.length} vendas antigas arquivadas`);
                databaseManager.monitor.logEvent('old_data_archived', { count: oldSales.length });
            }
            
        } catch (error) {
            console.error('❌ Erro ao limpar dados antigos:', error);
        }
    }
    
    async cleanup() {
        try {
            console.log('🧹 Executando limpeza periódica...');
            
            // Limpar cache de consultas muito antigas
            databaseManager.queryCache.clear();
            
            // Limpar logs de auditoria antigos (mantém apenas 90 dias)
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            
            const oldLogs = await databaseManager.getAuditLogs(1000, {
                endDate: ninetyDaysAgo.toISOString()
            });
            
            if (oldLogs.length > 0) {
                for (const log of oldLogs) {
                    await databaseManager.delete(databaseManager.stores.AUDIT_LOG, log.id);
                }
                
                console.log(`🗑️ ${oldLogs.length} logs antigos removidos`);
            }
            
            // Verificar integridade
            await this.checkDataIntegrity();
            
            console.log('✅ Limpeza periódica concluída');
            databaseManager.monitor.logEvent('periodic_cleanup_complete');
            
        } catch (error) {
            console.error('❌ Erro na limpeza periódica:', error);
        }
    }
    
    async checkDataIntegrity() {
        try {
            const [products, sales] = await Promise.all([
                databaseManager.getAll(databaseManager.stores.PRODUCTS),
                databaseManager.getAll(databaseManager.stores.SALES)
            ]);
            
            let issues = [];
            
            // Verificar produtos com estoque negativo
            const negativeStock = products.filter(p => p.stock < 0);
            if (negativeStock.length > 0) {
                issues.push(`${negativeStock.length} produtos com estoque negativo`);
                
                // Corrigir automaticamente
                for (const product of negativeStock) {
                    product.stock = Math.max(0, product.stock);
                    await databaseManager.update(databaseManager.stores.PRODUCTS, product);
                }
            }
            
            // Verificar vendas sem itens
            const emptySales = sales.filter(s => !s.items || s.items.length === 0);
            if (emptySales.length > 0) {
                issues.push(`${emptySales.length} vendas sem itens`);
            }
            
            // Verificar IDs duplicados
            const productIds = products.map(p => p.id);
            const duplicateIds = productIds.filter((id, index) => 
                productIds.indexOf(id) !== index
            );
            
            if (duplicateIds.length > 0) {
                issues.push(`${duplicateIds.length} IDs de produto duplicados`);
            }
            
            if (issues.length > 0) {
                console.warn('⚠️ Problemas de integridade encontrados:', issues);
                
                await databaseManager.logAudit('integrity_check', { 
                    issues,
                    autoFixed: negativeStock.length > 0 ? 'negative_stock' : 'none'
                });
            }
            
            return issues;
            
        } catch (error) {
            console.error('❌ Erro na verificação de integridade:', error);
            return ['Erro na verificação'];
        }
    }
}

// ============================================
// INSTÂNCIA GLOBAL E EXPORTAÇÃO
// ============================================

// Criar instância única do DatabaseManager
const databaseManager = new DatabaseManager();

// Exportar para uso global
window.CamarimDatabase = databaseManager;

// Inicializar automaticamente quando o DOM estiver carregado
document.addEventListener('DOMContentLoaded', () => {
    // Inicializar em segundo plano
    setTimeout(async () => {
        try {
            await databaseManager.init();
            
            // Mostrar métricas periodicamente (apenas em desenvolvimento)
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                setInterval(() => {
                    databaseManager.monitor.showMetrics();
                }, 30000); // A cada 30 segundos
            }
            
        } catch (error) {
            console.error('❌ Falha na inicialização do banco de dados:', error);
        }
    }, 1000);
});

// Exportar para módulos (se suportado)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = databaseManager;
}

export default databaseManager;