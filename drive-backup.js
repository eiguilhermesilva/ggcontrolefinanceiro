// drive-backup-simple.js
// Sistema de backup ULTRA SIMPLIFICADO para Google Drive

// PASSO 1: Obtenha estas credenciais em https://console.cloud.google.com/
var GOOGLE_CLIENT_ID = '951619466938-fnhdvhrvpp3jmj8om1pracs1pqarui1k.apps.googleusercontent.com';

// Estado do sistema
var backupState = {
    token: null,
    signedIn: false,
    backups: []
};

// ============================================
// 1. AUTENTICAÇÃO SIMPLES COM POPUP
// ============================================

/**
 * Faz login no Google Drive - MÉTODO SIMPLES
 */
function signInToDrive() {
    // Criar URL de autenticação
    var authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' +
        'client_id=' + encodeURIComponent(GOOGLE_CLIENT_ID) +
        '&redirect_uri=' + encodeURIComponent(window.location.origin + window.location.pathname) +
        '&response_type=token' +
        '&scope=' + encodeURIComponent('https://www.googleapis.com/auth/drive.file') +
        '&include_granted_scopes=true' +
        '&state=pass_through_value' +
        '&prompt=consent';
    
    // Abrir popup para login
    var width = 500;
    var height = 600;
    var left = (window.screen.width - width) / 2;
    var top = (window.screen.height - height) / 2;
    
    var popup = window.open(
        authUrl,
        'Google Login',
        'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top
    );
    
    // Verificar token periodicamente
    var checkPopup = setInterval(function() {
        try {
            if (popup.closed) {
                clearInterval(checkPopup);
                checkTokenFromURL();
            }
            
            // Tentar obter token do popup
            var popupUrl = popup.location.href;
            if (popupUrl.includes('access_token=')) {
                var token = extractTokenFromURL(popupUrl);
                if (token) {
                    backupState.token = token;
                    backupState.signedIn = true;
                    localStorage.setItem('drive_token', token);
                    popup.close();
                    clearInterval(checkPopup);
                    showBackupAlert('✅ Conectado ao Google Drive!', 'success');
                    updateBackupUI();
                    loadBackups();
                }
            }
        } catch (e) {
            // Ignorar erros de cross-origin
        }
    }, 500);
}

/**
 * Extrai token da URL
 */
function extractTokenFromURL(url) {
    var match = url.match(/access_token=([^&]+)/);
    return match ? match[1] : null;
}

/**
 * Verifica token na URL atual (para redirect)
 */
function checkTokenFromURL() {
    if (window.location.hash) {
        var token = extractTokenFromURL(window.location.hash);
        if (token) {
            backupState.token = token;
            backupState.signedIn = true;
            localStorage.setItem('drive_token', token);
            
            // Limpar URL
            history.replaceState(null, null, ' ');
            
            showBackupAlert('✅ Conectado ao Google Drive!', 'success');
            updateBackupUI();
            loadBackups();
        }
    }
}

/**
 * Faz logout
 */
function signOutFromDrive() {
    backupState.token = null;
    backupState.signedIn = false;
    localStorage.removeItem('drive_token');
    showBackupAlert('Desconectado do Google Drive', 'info');
    updateBackupUI();
}

/**
 * Tenta login automático com token salvo
 */
function tryAutoLogin() {
    var savedToken = localStorage.getItem('drive_token');
    if (savedToken) {
        // Verificar se o token ainda é válido
        fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + savedToken)
            .then(function(response) {
                if (response.ok) {
                    backupState.token = savedToken;
                    backupState.signedIn = true;
                    console.log('✅ Login automático realizado');
                    updateBackupUI();
                    loadBackups();
                } else {
                    localStorage.removeItem('drive_token');
                }
            })
            .catch(function() {
                localStorage.removeItem('drive_token');
            });
    }
}

// ============================================
// 2. SISTEMA DE BACKUP DIRETO
// ============================================

/**
 * Cria um backup simples
 */
async function createSimpleBackup(description) {
    if (!backupState.signedIn) {
        showBackupAlert('Faça login primeiro', 'warning');
        return false;
    }
    
    try {
        showBackupAlert('Criando backup...', 'info');
        
        // 1. Obter dados do sistema
        var systemData = await getSystemData();
        
        // 2. Adicionar informações do backup
        systemData.backupInfo = {
            date: new Date().toISOString(),
            description: description || 'Backup automático',
            version: '1.0',
            user: 'Sistema Camarim'
        };
        
        // 3. Criar nome do arquivo
        var dateStr = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
        var timeStr = new Date().toLocaleTimeString('pt-BR').replace(/:/g, '-');
        var fileName = 'Camarim_Backup_' + dateStr + '_' + timeStr + '.json';
        if (description) {
            fileName = 'Camarim_' + description.replace(/[^a-z0-9]/gi, '_') + '_' + dateStr + '.json';
        }
        
        // 4. Criar arquivo no Google Drive
        var success = await createFileInDrive(fileName, JSON.stringify(systemData, null, 2));
        
        if (success) {
            showBackupAlert('✅ Backup criado com sucesso!', 'success');
            loadBackups();
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.error('❌ Erro ao criar backup:', error);
        showBackupAlert('Erro: ' + error.message, 'error');
        return false;
    }
}

/**
 * Obtém dados do sistema
 */
async function getSystemData() {
    // Tentar usar databaseManager
    if (typeof databaseManager !== 'undefined' && databaseManager.getSystemData) {
        return await databaseManager.getSystemData();
    }
    
    // Fallback para localStorage
    var savedData = localStorage.getItem('camarim-system-data');
    if (savedData) {
        return JSON.parse(savedData);
    }
    
    // Dados vazios
    return {
        products: [],
        sales: [],
        settings: {},
        backupInfo: {
            date: new Date().toISOString(),
            message: 'Backup de dados vazios'
        }
    };
}

/**
 * Cria arquivo no Google Drive
 */
async function createFileInDrive(fileName, content) {
    var token = backupState.token;
    if (!token) throw new Error('Não autenticado');
    
    // 1. Procurar pasta "Camarim Backups" ou criar
    var folderId = await findOrCreateFolder('Camarim Backups');
    
    // 2. Criar arquivo
    var fileMetadata = {
        name: fileName,
        mimeType: 'application/json',
        parents: [folderId]
    };
    
    var formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(fileMetadata)], { type: 'application/json' }));
    formData.append('file', new Blob([content], { type: 'application/json' }));
    
    var response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token
        },
        body: formData
    });
    
    if (!response.ok) {
        var error = await response.json();
        throw new Error(error.error?.message || 'Erro ao criar arquivo');
    }
    
    return true;
}

/**
 * Encontra ou cria pasta no Google Drive
 */
async function findOrCreateFolder(folderName) {
    var token = backupState.token;
    
    // Procurar pasta existente
    var searchUrl = 'https://www.googleapis.com/drive/v3/files?' +
        'q=' + encodeURIComponent("name='" + folderName + "' and mimeType='application/vnd.google-apps.folder' and trashed=false") +
        '&fields=files(id,name)' +
        '&access_token=' + token;
    
    var response = await fetch(searchUrl);
    var data = await response.json();
    
    if (data.files && data.files.length > 0) {
        return data.files[0].id;
    }
    
    // Criar nova pasta
    var createUrl = 'https://www.googleapis.com/drive/v3/files?access_token=' + token;
    var folderData = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
    };
    
    var createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(folderData)
    });
    
    var newFolder = await createResponse.json();
    return newFolder.id;
}

// ============================================
// 3. LISTAR E RESTAURAR BACKUPS
// ============================================

/**
 * Lista backups disponíveis
 */
async function loadBackups() {
    if (!backupState.signedIn) return;
    
    try {
        var token = backupState.token;
        
        // 1. Encontrar pasta "Camarim Backups"
        var folderId = await findFolderId('Camarim Backups');
        if (!folderId) {
            backupState.backups = [];
            updateBackupListUI();
            return;
        }
        
        // 2. Buscar arquivos na pasta
        var searchUrl = 'https://www.googleapis.com/drive/v3/files?' +
            'q=' + encodeURIComponent("'" + folderId + "' in parents and mimeType='application/json' and trashed=false") +
            '&fields=files(id,name,createdTime,size)' +
            '&orderBy=createdTime desc' +
            '&access_token=' + token;
        
        var response = await fetch(searchUrl);
        var data = await response.json();
        
        if (data.files) {
            backupState.backups = data.files.map(function(file) {
                return {
                    id: file.id,
                    name: file.name,
                    date: new Date(file.createdTime),
                    size: file.size || 0,
                    formattedDate: new Date(file.createdTime).toLocaleString('pt-BR')
                };
            });
        } else {
            backupState.backups = [];
        }
        
        updateBackupListUI();
        
    } catch (error) {
        console.error('❌ Erro ao carregar backups:', error);
        backupState.backups = [];
    }
}

/**
 * Encontra ID da pasta
 */
async function findFolderId(folderName) {
    var token = backupState.token;
    
    var searchUrl = 'https://www.googleapis.com/drive/v3/files?' +
        'q=' + encodeURIComponent("name='" + folderName + "' and mimeType='application/vnd.google-apps.folder' and trashed=false") +
        '&fields=files(id)' +
        '&access_token=' + token;
    
    var response = await fetch(searchUrl);
    var data = await response.json();
    
    if (data.files && data.files.length > 0) {
        return data.files[0].id;
    }
    
    return null;
}

/**
 * Restaura um backup
 */
async function restoreBackup(fileId) {
    if (!confirm('⚠️ ATENÇÃO!\n\nIsso substituirá TODOS os dados atuais pelo backup.\n\nDeseja continuar?')) {
        return false;
    }
    
    try {
        showBackupAlert('Restaurando backup...', 'info');
        
        var token = backupState.token;
        
        // 1. Baixar arquivo
        var downloadUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media';
        var response = await fetch(downloadUrl, {
            headers: {
                'Authorization': 'Bearer ' + token
            }
        });
        
        if (!response.ok) throw new Error('Erro ao baixar arquivo');
        
        var backupData = await response.json();
        
        // 2. Validar dados
        if (!backupData.products || !Array.isArray(backupData.products)) {
            throw new Error('Arquivo de backup inválido');
        }
        
        // 3. Criar backup atual antes de restaurar
        await createSimpleBackup('antes_da_restauracao');
        
        // 4. Restaurar dados
        await applyBackupData(backupData);
        
        showBackupAlert('✅ Backup restaurado com sucesso!', 'success');
        return true;
        
    } catch (error) {
        console.error('❌ Erro ao restaurar:', error);
        showBackupAlert('Erro: ' + error.message, 'error');
        return false;
    }
}

/**
 * Aplica dados do backup
 */
async function applyBackupData(backupData) {
    // Atualizar systemData global
    if (typeof systemData !== 'undefined') {
        systemData.products = backupData.products || [];
        systemData.sales = backupData.sales || [];
        systemData.settings = backupData.settings || {};
    }
    
    // Salvar usando databaseManager
    if (typeof databaseManager !== 'undefined' && databaseManager.saveSystemData) {
        await databaseManager.saveSystemData(systemData);
    } else {
        // Fallback para localStorage
        localStorage.setItem('camarim-system-data', JSON.stringify(systemData));
    }
    
    // Recarregar interface
    setTimeout(function() {
        if (typeof loadData === 'function') loadData();
        if (typeof updateDashboard === 'function') updateDashboard();
        if (typeof updateProductsList === 'function') updateProductsList();
        if (typeof updateSalesList === 'function') updateSalesList();
        if (typeof showAlert === 'function') {
            showAlert('Dados restaurados do backup!', 'success');
        }
    }, 500);
}

/**
 * Baixa backup localmente
 */
async function downloadBackupLocally(fileId, fileName) {
    try {
        var token = backupState.token;
        
        var downloadUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media';
        var response = await fetch(downloadUrl, {
            headers: {
                'Authorization': 'Bearer ' + token
            }
        });
        
        if (!response.ok) throw new Error('Erro ao baixar');
        
        var backupData = await response.json();
        var dataStr = JSON.stringify(backupData, null, 2);
        var blob = new Blob([dataStr], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        
        var link = document.createElement('a');
        link.href = url;
        link.download = fileName || 'backup_camarim.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        URL.revokeObjectURL(url);
        
        showBackupAlert('✅ Backup baixado!', 'success');
        
    } catch (error) {
        console.error('❌ Erro ao baixar:', error);
        showBackupAlert('Erro ao baixar: ' + error.message, 'error');
    }
}

// ============================================
// 4. INTERFACE SIMPLES (APENAS BOTÃO NO HEADER)
// ============================================

/**
 * Adiciona interface básica
 */
function addSimpleBackupUI() {
    // Apenas botão no cabeçalho
    addHeaderButton();
    
    // Modal simples
    createSimpleModal();
}

/**
 * Adiciona botão no cabeçalho
 */
function addHeaderButton() {
    var headerActions = document.getElementById('header-actions');
    if (!headerActions) return;
    
    var button = document.createElement('button');
    button.id = 'simple-backup-btn';
    button.className = 'btn btn-light';
    button.innerHTML = '<i class="fab fa-google-drive"></i>';
    button.title = 'Google Drive Backup';
    button.style.marginLeft = '5px';
    
    button.addEventListener('click', showSimpleModal);
    
    headerActions.appendChild(button);
    
    // Atualizar aparência do botão baseado no estado
    updateHeaderButton();
}

/**
 * Atualiza aparência do botão do cabeçalho
 */
function updateHeaderButton() {
    var headerBtn = document.getElementById('simple-backup-btn');
    if (!headerBtn) return;
    
    if (backupState.signedIn) {
        headerBtn.className = 'btn btn-success';
        headerBtn.title = 'Conectado ao Google Drive - Clique para gerenciar backups';
        headerBtn.innerHTML = '<i class="fab fa-google-drive"></i>';
    } else {
        headerBtn.className = 'btn btn-light';
        headerBtn.title = 'Conectar ao Google Drive';
        headerBtn.innerHTML = '<i class="fab fa-google-drive"></i>';
    }
}

/**
 * Cria modal simples
 */
function createSimpleModal() {
    if (document.getElementById('simple-backup-modal')) return;
    
    var modal = document.createElement('div');
    modal.id = 'simple-backup-modal';
    modal.className = 'modal';
    modal.style.display = 'none';
    
    modal.innerHTML = '\
        <div class="modal-content" style="max-width: 700px;">\
            <div class="modal-header">\
                <h2><i class="fab fa-google-drive"></i> Google Drive Backup</h2>\
                <button class="modal-close">&times;</button>\
            </div>\
            \
            <div class="modal-body">\
                <div id="simple-modal-status" class="alert alert-info">\
                    <i class="fas fa-info-circle"></i> Conecte-se ao Google Drive\
                </div>\
                \
                <div id="simple-modal-login" class="text-center p-20">\
                    <button id="modal-login-btn" class="btn btn-success btn-large">\
                        <i class="fas fa-sign-in-alt"></i> Conectar ao Google Drive\
                    </button>\
                    <p class="text-muted mt-10">Armazene seus backups com segurança na nuvem</p>\
                </div>\
                \
                <div id="simple-modal-content" class="d-none">\
                    <div class="row mb-20">\
                        <div class="col-12 mb-10">\
                            <div class="alert alert-success">\
                                <i class="fas fa-check-circle"></i> Conectado ao Google Drive\
                                <button id="modal-logout-btn" class="btn btn-warning btn-sm float-right">\
                                    <i class="fas fa-sign-out-alt"></i> Desconectar\
                                </button>\
                            </div>\
                        </div>\
                        <div class="col-8">\
                            <input type="text" id="modal-backup-name" class="form-control" placeholder="Descrição do backup (opcional)">\
                        </div>\
                        <div class="col-4">\
                            <button id="modal-create-backup" class="btn btn-primary btn-block">\
                                <i class="fas fa-plus"></i> Criar Backup\
                            </button>\
                        </div>\
                    </div>\
                    \
                    <div id="backups-list" style="max-height: 400px; overflow-y: auto;">\
                        <div class="text-center text-muted p-40">\
                            <i class="fas fa-inbox fa-3x"></i>\
                            <p class="mt-20">Nenhum backup encontrado</p>\
                        </div>\
                    </div>\
                </div>\
            </div>\
            \
            <div class="modal-footer">\
                <button class="btn btn-secondary modal-close">Fechar</button>\
            </div>\
        </div>\
    ';
    
    document.body.appendChild(modal);
    
    // Event listeners
    setTimeout(function() {
        // Fechar modal
        modal.querySelectorAll('.modal-close').forEach(function(btn) {
            btn.addEventListener('click', function() {
                modal.style.display = 'none';
            });
        });
        
        // Login no modal
        document.getElementById('modal-login-btn')?.addEventListener('click', async function() {
            await signInToDrive();
            updateSimpleModal();
        });
        
        // Logout no modal
        document.getElementById('modal-logout-btn')?.addEventListener('click', async function() {
            await signOutFromDrive();
            updateSimpleModal();
        });
        
        // Criar backup no modal
        document.getElementById('modal-create-backup')?.addEventListener('click', async function() {
            var name = document.getElementById('modal-backup-name')?.value || '';
            await createSimpleBackup(name);
            document.getElementById('modal-backup-name').value = '';
            updateBackupListInModal();
        });
        
        // Fechar ao clicar fora
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
        
        updateSimpleModal();
    }, 100);
}

/**
 * Mostra o modal
 */
function showSimpleModal() {
    var modal = document.getElementById('simple-backup-modal');
    if (modal) {
        modal.style.display = 'flex';
        updateSimpleModal();
        updateBackupListInModal();
    }
}

/**
 * Atualiza modal
 */
function updateSimpleModal() {
    var modal = document.getElementById('simple-backup-modal');
    if (!modal) return;
    
    var statusEl = document.getElementById('simple-modal-status');
    var loginSection = document.getElementById('simple-modal-login');
    var contentSection = document.getElementById('simple-modal-content');
    
    if (backupState.signedIn) {
        statusEl.className = 'd-none';
        if (loginSection) loginSection.classList.add('d-none');
        if (contentSection) contentSection.classList.remove('d-none');
    } else {
        statusEl.className = 'alert alert-info';
        statusEl.innerHTML = '<i class="fab fa-google-drive"></i> Conecte-se ao Google Drive';
        if (loginSection) loginSection.classList.remove('d-none');
        if (contentSection) contentSection.classList.add('d-none');
    }
}

/**
 * Atualiza UI do backup
 */
function updateBackupUI() {
    updateHeaderButton();
    updateSimpleModal();
}

/**
 * Atualiza lista de backups no modal
 */
function updateBackupListInModal() {
    var container = document.getElementById('backups-list');
    if (!container) return;
    
    if (!backupState.signedIn || backupState.backups.length === 0) {
        container.innerHTML = '\
            <div class="text-center text-muted p-40">\
                <i class="fas fa-inbox fa-3x"></i>\
                <p class="mt-20">' + 
                    (backupState.signedIn ? 'Nenhum backup encontrado' : 'Conecte-se para ver backups') + 
                '</p>\
            </div>\
        ';
        return;
    }
    
    var html = '<div class="backup-items">';
    
    backupState.backups.forEach(function(backup) {
        var dateStr = backup.formattedDate;
        var name = backup.name.replace('.json', '').replace(/Camarim_/g, '').replace(/_/g, ' ');
        
        html += '\
            <div class="backup-item">\
                <div class="backup-item-info">\
                    <div class="backup-name"><i class="fas fa-file-archive"></i> ' + name + '</div>\
                    <div class="backup-date">' + dateStr + '</div>\
                </div>\
                <div class="backup-item-actions">\
                    <button class="btn btn-small btn-success restore-simple-btn" data-id="' + backup.id + '">\
                        <i class="fas fa-download"></i> Restaurar\
                    </button>\
                    <button class="btn btn-small btn-info download-simple-btn" data-id="' + backup.id + '" data-name="' + backup.name + '">\
                        <i class="fas fa-file-download"></i> Baixar\
                    </button>\
                </div>\
            </div>\
        ';
    });
    
    html += '</div>';
    container.innerHTML = html;
    
    // Event listeners
    setTimeout(function() {
        // Restaurar
        container.querySelectorAll('.restore-simple-btn').forEach(function(btn) {
            btn.addEventListener('click', async function() {
                var fileId = this.getAttribute('data-id');
                var success = await restoreBackup(fileId);
                if (success) {
                    var modal = document.getElementById('simple-backup-modal');
                    if (modal) modal.style.display = 'none';
                }
            });
        });
        
        // Baixar
        container.querySelectorAll('.download-simple-btn').forEach(function(btn) {
            btn.addEventListener('click', async function() {
                var fileId = this.getAttribute('data-id');
                var fileName = this.getAttribute('data-name');
                await downloadBackupLocally(fileId, fileName);
            });
        });
    }, 100);
}

/**
 * Atualiza lista de backups na UI geral
 */
function updateBackupListUI() {
    updateBackupListInModal();
}

// ============================================
// 5. UTILITÁRIOS
// ============================================

/**
 * Mostra alerta
 */
function showBackupAlert(message, type) {
    // Usar sistema existente
    if (typeof showAlert === 'function') {
        showAlert(message, type);
        return;
    }
    
    // Criar alerta simples
    var alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-' + type;
    alertDiv.style.cssText = '\
        position: fixed;\
        top: 20px;\
        right: 20px;\
        z-index: 9999;\
        padding: 15px;\
        border-radius: 5px;\
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);\
        max-width: 400px;\
        animation: slideIn 0.3s ease;\
    ';
    
    var icon = type === 'success' ? 'check-circle' :
              type === 'error' ? 'exclamation-triangle' :
              type === 'warning' ? 'exclamation-circle' : 'info-circle';
    
    alertDiv.innerHTML = '\
        <i class="fas fa-' + icon + '" style="margin-right: 10px;"></i>\
        ' + message + '\
    ';
    
    document.body.appendChild(alertDiv);
    
    setTimeout(function() {
        alertDiv.style.animation = 'slideOut 0.3s ease';
        setTimeout(function() {
            if (alertDiv.parentNode) {
                alertDiv.parentNode.removeChild(alertDiv);
            }
        }, 300);
    }, 4000);
    
    // Adicionar estilos CSS se não existirem
    if (!document.getElementById('backup-alert-styles')) {
        var style = document.createElement('style');
        style.id = 'backup-alert-styles';
        style.textContent = '\
            @keyframes slideIn {\
                from { transform: translateX(100%); opacity: 0; }\
                to { transform: translateX(0); opacity: 1; }\
            }\
            @keyframes slideOut {\
                from { transform: translateX(0); opacity: 1; }\
                to { transform: translateX(100%); opacity: 0; }\
            }\
            .backup-item {\
                border: 1px solid #ddd;\
                border-radius: 5px;\
                padding: 15px;\
                margin-bottom: 10px;\
                display: flex;\
                justify-content: space-between;\
                align-items: center;\
            }\
            .backup-item-info {\
                flex: 1;\
            }\
            .backup-name {\
                font-weight: bold;\
                margin-bottom: 5px;\
            }\
            .backup-date {\
                color: #666;\
                font-size: 0.9em;\
            }\
        ';
        document.head.appendChild(style);
    }
}

// ============================================
// 6. INICIALIZAÇÃO E INTEGRAÇÃO
// ============================================

/**
 * Inicializa o sistema
 */
function initSimpleBackup() {
    console.log('🚀 Iniciando sistema de backup simples...');
    
    // Verificar token na URL (para redirect)
    checkTokenFromURL();
    
    // Tentar login automático
    tryAutoLogin();
    
    // Adicionar UI
    setTimeout(addSimpleBackupUI, 1000);
    
    console.log('✅ Sistema de backup pronto');
}

/**
 * Integra com sistema principal
 */
function integrateWithMainSystem() {
    // Backup automático após salvar
    if (typeof saveData === 'function') {
        var originalSaveData = saveData;
        saveData = async function() {
            var result = await originalSaveData.apply(this, arguments);
            
            // Backup automático (apenas se estiver logado e não houver backup recente)
            if (backupState.signedIn) {
                var lastBackup = localStorage.getItem('last_auto_backup');
                var now = Date.now();
                
                if (!lastBackup || (now - parseInt(lastBackup)) > 3600000) { // 1 hora
                    setTimeout(function() {
                        createSimpleBackup('auto_save');
                        localStorage.setItem('last_auto_backup', now.toString());
                    }, 2000);
                }
            }
            
            return result;
        };
    }
}

// ============================================
// 7. INICIALIZAÇÃO AUTOMÁTICA
// ============================================

// Inicializar quando a página carregar
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        initSimpleBackup();
        setTimeout(integrateWithMainSystem, 2000);
    });
} else {
    initSimpleBackup();
    setTimeout(integrateWithMainSystem, 2000);
}

// ============================================
// 8. API PÚBLICA (opcional)
// ============================================

window.SimpleDriveBackup = {
    login: signInToDrive,
    logout: signOutFromDrive,
    createBackup: createSimpleBackup,
    restoreBackup: restoreBackup,
    showModal: showSimpleModal,
    isConnected: function() { return backupState.signedIn; },
    setClientId: function(clientId) { GOOGLE_CLIENT_ID = clientId; }
};

console.log('✅ Sistema de backup SIMPLES carregado');
