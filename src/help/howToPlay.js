import './howToPlay.css';

/**
 * Persistent, presentation-only help control.
 * Deliberately does not navigate, change gameplay state or call wallet APIs.
 * Existing illustrated tutorials are reused by providing their slide paths.
 */
export function installHowToPlay({ title, steps, tips, slideCount = 0, slidePath } = {}) {
  if (!document.body || document.getElementById('gp-how-to-play-trigger')) return;
  if (typeof title !== 'string' || !Array.isArray(steps) || !Array.isArray(tips) ||
      steps.length === 0 || tips.length === 0) throw new TypeError('How to Play content is required');

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const trigger = make('button', 'gp-help-trigger', '?');
  trigger.id = 'gp-how-to-play-trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-label', 'How to Play');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.title = 'How to Play';

  const backdrop = make('div', 'gp-help-backdrop');
  backdrop.hidden = true;
  const dialog = make('section', 'gp-help-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'gp-how-to-play-title');
  dialog.tabIndex = -1;
  const header = make('header', 'gp-help-header');
  const heading = make('h2', 'gp-help-title', 'How to Play');
  heading.id = 'gp-how-to-play-title';
  const closeButton = make('button', 'gp-help-close', '×');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close How to Play');
  header.append(heading, closeButton);
  dialog.append(header);
  dialog.append(make('p', 'gp-help-game-title', title));

  let slideIndex = 0;
  let slideImage;
  let slideLabel;
  let prev;
  let next;
  const withSlides = Number.isInteger(slideCount) && slideCount > 0 && typeof slidePath === 'function';
  if (withSlides) {
    dialog.append(make('p', 'gp-help-section-title', 'Original game tutorial'));
    const slideBox = make('div', 'gp-help-slide-box');
    slideImage = make('img', 'gp-help-slide-image');
    slideImage.alt = 'Illustrated game tutorial';
    slideImage.decoding = 'async';
    slideBox.append(slideImage);
    dialog.append(slideBox);
    const nav = make('div', 'gp-help-slide-nav');
    prev = make('button', 'gp-help-nav-button', 'Previous');
    next = make('button', 'gp-help-nav-button', 'Next');
    prev.type = 'button';
    next.type = 'button';
    slideLabel = make('span', 'gp-help-slide-label');
    nav.append(prev, slideLabel, next);
    dialog.append(nav);
    const updateSlide = () => {
      const orientation = window.matchMedia?.('(orientation: portrait)').matches ? 'portrait' : 'landscape';
      slideImage.src = slidePath(orientation, slideIndex + 1);
      slideImage.alt = title + ': tutorial page ' + (slideIndex + 1) + ' of ' + slideCount;
      slideLabel.textContent = (slideIndex + 1) + ' / ' + slideCount;
      prev.disabled = slideIndex === 0;
      next.disabled = slideIndex === slideCount - 1;
    };
    prev.addEventListener('click', () => { slideIndex = Math.max(0, slideIndex - 1); updateSlide(); });
    next.addEventListener('click', () => { slideIndex = Math.min(slideCount - 1, slideIndex + 1); updateSlide(); });
    window.addEventListener('resize', () => { if (!backdrop.hidden) updateSlide(); }, { passive: true });
    dialog._updateHelpSlide = updateSlide;
  }

  const buildList = (items, listTag) => {
    const list = make(listTag, 'gp-help-list');
    for (const item of items) list.append(make('li', '', item));
    return list;
  };
  dialog.append(make('h3', 'gp-help-section-title', 'Quick rules'));
  dialog.append(buildList(steps, 'ol'));
  dialog.append(make('h3', 'gp-help-section-title', 'Tips'));
  dialog.append(buildList(tips, 'ul'));
  const footer = make('p', 'gp-help-footer', 'Close this panel to return to your game.');
  dialog.append(footer);
  backdrop.append(dialog);
  document.body.append(trigger, backdrop);

  let returnFocus = null;
  function close() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    (returnFocus?.isConnected ? returnFocus : trigger).focus({ preventScroll: true });
  }
  function open() {
    if (!backdrop.hidden) return;
    returnFocus = document.activeElement;
    slideIndex = 0;
    dialog._updateHelpSlide?.();
    backdrop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    closeButton.focus({ preventScroll: true });
  }

  trigger.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  // Keep game keyboard, shooting/tap and flipper listeners from receiving
  // interactions with the modal. Game timers and network sessions are untouched.
  const stopWhileOpen = (event) => {
    if (backdrop.hidden) return;
    if (event.type === 'keydown') {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'Tab') {
        const controls = [closeButton, ...(withSlides ? [prev, next].filter(b => !b.disabled) : [])];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      } else if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) &&
                 !['BUTTON'].includes(document.activeElement?.tagName)) event.preventDefault();
    }
    event.stopImmediatePropagation();
  };
  document.addEventListener('keydown', stopWhileOpen, true);
  document.addEventListener('keyup', stopWhileOpen, true);
  for (const element of [trigger, backdrop]) {
    for (const name of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click']) {
      element.addEventListener(name, event => event.stopPropagation());
    }
  }
  return Object.freeze({ open, close });
}
