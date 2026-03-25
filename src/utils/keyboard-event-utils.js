const EDITABLE_ROLE_SELECTOR = '[role="textbox"], [role="searchbox"], [role="combobox"]';
const EDITABLE_PARENT_SELECTOR = `[contenteditable]:not([contenteditable="false"]), ${EDITABLE_ROLE_SELECTOR}`;

function normalizeElement(element) {
  if (!element) return null;
  if (element.nodeType === Node.ELEMENT_NODE) return element;
  return element.parentElement || null;
}

export function getDeepEventTarget(event) {
  const composedTarget = event?.composedPath?.()[0];
  return normalizeElement(composedTarget) || normalizeElement(event?.target);
}

export function isInputField(element) {
  const normalizedElement = normalizeElement(element);
  if (!normalizedElement) return false;

  return (
    normalizedElement.matches('input, textarea') ||
    normalizedElement.isContentEditable ||
    normalizedElement.closest(EDITABLE_PARENT_SELECTOR) !== null
  );
}
