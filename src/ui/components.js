/**
 * UI Components
 * Reusable UI component helpers and utilities
 * 
 * v1.5.9.0 - Following modular-architecture-blueprint.md
 */

/**
 * Create a styled button component
 */
export function createStyledButton(options) {
  const {
    text = '',
    onClick = () => {},
    style = {},
    className = ''
  } = options;

  const button = document.createElement('button');
  button.textContent = text;
  button.className = className;

  // Apply default styles
  Object.assign(button.style, {
    cursor: 'pointer',
    border: '1px solid #666',
    borderRadius: '4px',
    padding: '6px 12px',
    backgroundColor: 'transparent',
    color: '#fff',
    fontSize: '14px',
    transition: 'background-color 0.2s',
    ...style
  });

  button.addEventListener('click', onClick);

  return button;
}

/**
 * Create a modal overlay
 */
export function createModal(options) {
  const {
    title = '',
    content = '',
    onClose = () => {},
    width = '400px'
  } = options;

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999999;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background-color: #2d2d2d;
    border-radius: 8px;
    padding: 20px;
    width: ${width};
    max-width: 90%;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    color: #fff;
  `;

  const titleEl = document.createElement('h3');
  titleEl.textContent = title;
  titleEl.style.cssText = 'margin: 0 0 15px 0; font-size: 18px;';

  const contentEl = document.createElement('div');
  contentEl.innerHTML = content;

  const closeBtn = createStyledButton({
    text: 'Close',
    onClick: () => {
      overlay.remove();
      onClose();
    },
    style: {
      marginTop: '15px',
      backgroundColor: '#444'
    }
  });

  modal.appendChild(titleEl);
  modal.appendChild(contentEl);
  modal.appendChild(closeBtn);
  overlay.appendChild(modal);

  return overlay;
}

/**
 * Create a draggable panel
 */
export function createDraggablePanel(options) {
  const {
    title = '',
    width = '300px',
    height = 'auto',
    left = '100px',
    top = '100px'
  } = options;

  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed;
    left: ${left};
    top: ${top};
    width: ${width};
    height: ${height};
    background-color: #1e1e1e;
    border: 2px solid #444;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    z-index: 999999990;
  `;

  return panel;
}
