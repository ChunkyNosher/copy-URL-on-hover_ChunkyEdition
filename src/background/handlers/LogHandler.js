/**
 * LogHandler - Handles log export and clearing operations
 *
 * Actions handled:
 * - CLEAR_CONSOLE_LOGS: Clear all logs (background + all content scripts)
 * - GET_BACKGROUND_LOGS: Retrieve background script logs
 * - EXPORT_LOGS: Export logs to file via downloads API
 */

export class LogHandler {
  constructor(logBuffer, downloadsAPI, browserAPI) {
    this.logBuffer = logBuffer;
    this.downloadsAPI = downloadsAPI;
    this.browserAPI = browserAPI;
    this.pendingDownloads = new Map();
  }

  /**
   * Clear all logs across background and content scripts
   */
  async handleClearLogs(_message, _sender) {
    const clearedBackgroundEntries = this.clearBackgroundLogs();
    let clearedTabs = 0;

    if (this.browserAPI?.tabs?.query) {
      try {
        const tabs = await this.browserAPI.tabs.query({});
        const results = await Promise.allSettled(
          tabs.map(tab =>
            this.browserAPI.tabs
              .sendMessage(tab.id, {
                action: 'CLEAR_CONTENT_LOGS'
              })
              .catch(() => ({ success: false }))
          )
        );

        clearedTabs = results.filter(
          result => result.status === 'fulfilled' && result.value?.success
        ).length;
      } catch (error) {
        console.warn('[LogHandler] Failed to broadcast CLEAR_CONTENT_LOGS:', error);
      }
    }

    return { success: true, clearedTabs, clearedBackgroundEntries };
  }

  /**
   * Get background script logs
   */
  async handleGetLogs(_message, _sender) {
    return { logs: [...this.logBuffer] };
  }

  /**
   * Export logs to file
   */
  async handleExportLogs(message, _sender) {
    if (typeof message.logText !== 'string' || typeof message.filename !== 'string') {
      throw new Error('Invalid log export payload');
    }

    await this.exportLogsToFile(message.logText, message.filename);
    return { success: true };
  }

  /**
   * Clear background log buffer
   * @returns {number} Number of cleared entries
   */
  clearBackgroundLogs() {
    const cleared = this.logBuffer.length;
    this.logBuffer.length = 0;
    return cleared;
  }

  /**
   * Export logs to file via downloads API
   * @param {string} logText - Log content
   * @param {string} filename - Target filename
   */
  async exportLogsToFile(logText, filename) {
    if (!this.downloadsAPI || !this.downloadsAPI.download) {
      throw new Error('Downloads API not available');
    }

    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        URL.revokeObjectURL(url);
        this.pendingDownloads.delete(downloadId);
        reject(new Error('Download timeout after 60 seconds'));
      }, 60000);

      this.downloadsAPI.download(
        {
          url: url,
          filename: filename,
          saveAs: true
        },
        downloadId => {
          if (!downloadId) {
            clearTimeout(timeoutId);
            URL.revokeObjectURL(url);
            const error = this.downloadsAPI.runtime?.lastError;
            reject(new Error(error?.message || 'Download failed'));
            return;
          }

          this.pendingDownloads.set(downloadId, { url, timeoutId });

          const changeListener = delta => {
            if (delta.id !== downloadId) return;

            if (delta.state?.current === 'complete') {
              clearTimeout(timeoutId);
              URL.revokeObjectURL(url);
              this.pendingDownloads.delete(downloadId);
              this.downloadsAPI.onChanged.removeListener(changeListener);
              resolve();
            } else if (delta.state?.current === 'interrupted') {
              clearTimeout(timeoutId);
              URL.revokeObjectURL(url);
              this.pendingDownloads.delete(downloadId);
              this.downloadsAPI.onChanged.removeListener(changeListener);
              reject(new Error('Download interrupted'));
            }
          };

          this.downloadsAPI.onChanged.addListener(changeListener);
        }
      );
    });
  }
}
