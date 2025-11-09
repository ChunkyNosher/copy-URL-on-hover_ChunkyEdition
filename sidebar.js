/**
 * Sidebar Script - Manages the persistent Quick Tabs sidebar
 * 
 * This script runs in the sidebar panel context and manages:
 * - Quick Tab list display
 * - Active Quick Tab iframe management
 * - Navigation controls
 * - Cross-tab communication
 */

// Browser API compatibility
if (typeof browser === 'undefined') {
  var browser = chrome;
}

// ============================================
// Global State
// ============================================

let quickTabsStore = new Map(); // URL -> { title, url, favicon }
let activeQuickTabUrl = null;
let currentIframe = null;

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    loadQuickTabsFromStorage();
});

function initializeEventListeners() {
    // Header controls
    document.getElementById('clear-all-btn').addEventListener('click', clearAllQuickTabs);
    document.getElementById('settings-btn').addEventListener('click', openSettings);
    
    // Navigation controls
    document.getElementById('btn-back').addEventListener('click', navigateBack);
    document.getElementById('btn-forward').addEventListener('click', navigateForward);
    document.getElementById('btn-reload').addEventListener('click', reloadIframe);
    document.getElementById('btn-open-external').addEventListener('click', openInNewTab);
}

// ============================================
// Listen for Messages from Content Scripts
// ============================================

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'createQuickTab') {
        addQuickTab(message.url, message.title || 'Untitled', sender.url);
        sendResponse({ success: true });
        return true
    } else if (message.action === 'getQuickTabsCount') {
        sendResponse({ count: quickTabsStore.size });
        return true
    }
    return true; // Keep channel open for async response
});

// ============================================
// Quick Tab Management
// ============================================

function addQuickTab(url, title, referrerUrl) {
    try {
        const urlObj = new URL(url);
        const key = urlObj.href;
        
        // Get favicon from Google Favicon service
        const domain = urlObj.hostname;
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        
        // Add or update in store
        quickTabsStore.set(key, {
            url: url,
            title: title || domain,
            favicon: faviconUrl,
            createdAt: Date.now()
        });
        
        // Save to browser storage
        saveQuickTabsToStorage();
        
        // Render the list
        renderQuickTabsList();
        
        // Auto-select the newly created Quick Tab
        selectQuickTab(key);
        
        debug(`Quick Tab added: ${title}`);
        
    } catch (error) {
        console.error('Error adding Quick Tab:', error);
    }
}

function removeQuickTab(key) {
    quickTabsStore.delete(key);
    saveQuickTabsToStorage();
    renderQuickTabsList();
    
    // If this was the active tab, select the first remaining one
    if (activeQuickTabUrl === key) {
        const firstEntry = quickTabsStore.entries().next().value;
        if (firstEntry) {
            selectQuickTab(firstEntry[0]);
        } else {
            activeQuickTabUrl = null;
            clearIframeDisplay();
        }
    }
    
    debug(`Quick Tab removed: ${key}`);
}

function selectQuickTab(key) {
    const tab = quickTabsStore.get(key);
    if (!tab) return;
    
    activeQuickTabUrl = key;
    renderQuickTabsList(); // Update UI to show active state
    loadIframeWithUrl(tab.url);
    
    debug(`Quick Tab selected: ${tab.title}`);
}

function clearAllQuickTabs() {
    if (quickTabsStore.size === 0) return;
    
    if (confirm('Are you sure you want to close all Quick Tabs?')) {
        quickTabsStore.clear();
        saveQuickTabsToStorage();
        activeQuickTabUrl = null;
        renderQuickTabsList();
        clearIframeDisplay();
        debug('All Quick Tabs cleared');
    }
}

// ============================================
// Iframe Management
// ============================================

function loadIframeWithUrl(url) {
    const container = document.getElementById('iframe-container');
    
    // Remove existing iframe
    const existingIframe = container.querySelector('iframe');
    if (existingIframe) {
        existingIframe.remove();
    }
    
    // Create new iframe
    currentIframe = document.createElement('iframe');
    currentIframe.src = url;
    currentIframe.style.cssText = `
        width: 100%;
        height: 100%;
        border: none;
    `;
    
    // Handle iframe errors
    currentIframe.addEventListener('error', () => {
        console.error('Error loading iframe:', url);
        showErrorMessage('Failed to load page');
    });
    
    container.appendChild(currentIframe);
    updateNavigationControlsState();
    
    debug(`Iframe loaded with URL: ${url}`);
}

function clearIframeDisplay() {
    const container = document.getElementById('iframe-container');
    container.innerHTML = '';
    currentIframe = null;
}

function showErrorMessage(message) {
    const container = document.getElementById('iframe-container');
    container.innerHTML = `
        <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: #666;
            text-align: center;
            padding: 16px;
        ">
            <div>
                <p style="font-size: 14px; margin-bottom: 8px;">⚠️ ${message}</p>
                <small>${activeQuickTabUrl || 'No URL loaded'}</small>
            </div>
        </div>
    `;
}

// ============================================
// Navigation Controls
// ============================================

function navigateBack() {
    if (currentIframe && currentIframe.contentWindow.history.length > 1) {
        try {
            currentIframe.contentWindow.history.back();
        } catch (error) {
            console.error('Error navigating back:', error);
        }
    }
}

function navigateForward() {
    if (currentIframe) {
        try {
            currentIframe.contentWindow.history.forward();
        } catch (error) {
            console.error('Error navigating forward:', error);
        }
    }
}

function reloadIframe() {
    if (currentIframe) {
        try {
            currentIframe.contentWindow.location.reload();
        } catch (error) {
            console.error('Error reloading iframe:', error);
        }
    }
}

function openInNewTab() {
    if (activeQuickTabUrl) {
        browser.tabs.create({ url: activeQuickTabUrl });
    }
}

function updateNavigationControlsState() {
    // Due to sandbox restrictions, we can't directly check history
    // So we always keep them enabled
    document.getElementById('btn-back').disabled = false;
    document.getElementById('btn-forward').disabled = false;
}

// ============================================
// Rendering
// ============================================

function renderQuickTabsList() {
    const listContainer = document.getElementById('quick-tabs-list');
    
    if (quickTabsStore.size === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <p>No Quick Tabs open</p>
                <small>Hover over a link and press <kbd>Q</kbd> to create one</small>
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = '';
    
    quickTabsStore.forEach((tab, key) => {
        const item = document.createElement('div');
        item.className = 'quick-tab-item';
        if (key === activeQuickTabUrl) {
            item.classList.add('active');
        }
        
        // Favicon
        const favicon = document.createElement('img');
        favicon.className = 'quick-tab-favicon';
        favicon.src = tab.favicon;
        favicon.onerror = () => {
            favicon.style.display = 'none';
        };
        
        // Title and URL info
        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
            cursor: pointer;
        `;
        
        const titleElement = document.createElement('div');
        titleElement.className = 'quick-tab-title';
        titleElement.textContent = tab.title;
        
        const urlElement = document.createElement('div');
        urlElement.className = 'quick-tab-url';
        urlElement.textContent = new URL(tab.url).hostname;
        
        titleDiv.appendChild(titleElement);
        titleDiv.appendChild(urlElement);
        
        // Make title/URL clickable to select the tab
        titleDiv.addEventListener('click', () => selectQuickTab(key));
        
        // Action buttons
        const actions = document.createElement('div');
        actions.className = 'quick-tab-actions';
        
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕';
        removeBtn.title = 'Close';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeQuickTab(key);
        });
        
        actions.appendChild(removeBtn);
        
        // Assemble
        item.appendChild(favicon);
        item.appendChild(titleDiv);
        item.appendChild(actions);
        
        listContainer.appendChild(item);
    });
}

// ============================================
// Storage Management
// ============================================

function saveQuickTabsToStorage() {
    const data = Array.from(quickTabsStore.entries()).map(([key, tab]) => ({
        url: tab.url,
        title: tab.title,
        favicon: tab.favicon,
        createdAt: tab.createdAt
    }));
    
    browser.storage.local.set({ sidebarQuickTabs: data });
}

function loadQuickTabsFromStorage() {
    browser.storage.local.get(['sidebarQuickTabs'], (result) => {
        if (result.sidebarQuickTabs && Array.isArray(result.sidebarQuickTabs)) {
            quickTabsStore.clear();
            result.sidebarQuickTabs.forEach(tab => {
                quickTabsStore.set(tab.url, tab);
            });
            renderQuickTabsList();
        }
    });
}

// ============================================
// Settings
// ============================================

function openSettings() {
    browser.runtime.openOptionsPage();
}

// ============================================
// Utilities
// ============================================

function debug(message) {
    console.log('[Quick Tabs Sidebar]', message);
}
