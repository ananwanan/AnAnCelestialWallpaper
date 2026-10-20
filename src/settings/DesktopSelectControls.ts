type NavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

/** Keyboard movement skips disabled entries and wraps within the finite option list. */
export function optionNavigationIndex(disabled: readonly boolean[], current: number, key: NavigationKey): number {
  const enabled = disabled.flatMap((value, index) => value ? [] : [index]);
  if (enabled.length === 0) return -1;
  if (key === 'Home') return enabled[0]!;
  if (key === 'End') return enabled[enabled.length - 1]!;
  const position = enabled.indexOf(current);
  if (position < 0) return key === 'ArrowUp' ? enabled[enabled.length - 1]! : enabled[0]!;
  return enabled[(position + (key === 'ArrowUp' ? -1 : 1) + enabled.length) % enabled.length]!;
}

interface SelectView {
  model: HTMLSelectElement;
  wrapper: HTMLSpanElement;
  trigger: HTMLButtonElement;
  list: HTMLDivElement;
  signature: string;
  active: number;
  buttons: HTMLButtonElement[];
  observer: MutationObserver;
}

/** HTML-only presentation; native selects stay hidden as the existing value/options/change model. */
export class DesktopSelectControls {
  private readonly events = new AbortController();
  private readonly views: SelectView[] = [];
  private disposed = false;

  constructor(root: HTMLElement, private readonly emptyLabel: () => string = () => 'No data available') {
    for (const model of Array.from(root.querySelectorAll<HTMLSelectElement>('select'))) {
      model.hidden = true;
      model.tabIndex = -1;
      model.setAttribute('aria-hidden', 'true');
      const parent = model.parentElement!;
      // A label must not forward caption clicks to the hidden native select.
      if (parent.tagName === 'LABEL') {
        const row = document.createElement('div'); row.className = parent.className;
        while (parent.firstChild) row.append(parent.firstChild);
        parent.replaceWith(row);
      }
      const wrapper = document.createElement('span'); wrapper.className = 'desktop-select';
      const trigger = document.createElement('button');
      trigger.type = 'button'; trigger.id = `${model.id}-button`; trigger.className = 'desktop-select-trigger';
      trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', `${model.id}-options`);
      const list = document.createElement('div');
      list.id = `${model.id}-options`; list.className = 'desktop-select-options'; list.hidden = true;
      list.setAttribute('role', 'listbox');
      wrapper.append(trigger, list); model.after(wrapper);
      const view: SelectView = { model, wrapper, trigger, list, signature: '', active: -1, buttons: [], observer: new MutationObserver(() => this.refreshView(view)) };
      this.views.push(view);
      view.observer.observe(model, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'label', 'value', 'selected'] });
      trigger.addEventListener('click', () => { if (list.hidden) this.open(view); else this.close(view); }, { signal: this.events.signal });
      list.addEventListener('click', event => {
        const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-option-index]') : null;
        if (button && list.contains(button)) this.choose(view, Number(button.dataset.optionIndex));
      }, { signal: this.events.signal });
      wrapper.addEventListener('keydown', event => this.onKey(view, event), { signal: this.events.signal });
      model.addEventListener('change', () => this.refreshView(view), { signal: this.events.signal });
      this.refreshView(view);
    }
    document.addEventListener('pointerdown', event => {
      if (!(event.target instanceof Node)) return;
      for (const view of this.views) if (!view.wrapper.contains(event.target)) this.close(view);
    }, { signal: this.events.signal });
    document.addEventListener('focusin', event => {
      if (!(event.target instanceof Node)) return;
      for (const view of this.views) if (!view.wrapper.contains(event.target)) this.close(view);
    }, { signal: this.events.signal });
  }

  /** Call after assigning a model.value property; option/disabled mutations are observed automatically. */
  refresh(): void { if (!this.disposed) for (const view of this.views) this.refreshView(view); }
  closeAll(): void { for (const view of this.views) this.close(view); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.closeAll(); this.events.abort();
    for (const view of this.views) view.observer.disconnect();
  }

  private refreshView(view: SelectView): void {
    if (this.disposed) return;
    const options = Array.from(view.model.options);
    const signature = JSON.stringify(options.map(option => [option.value, option.label, option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)]));
    if (signature !== view.signature) {
      view.signature = signature;
      view.buttons = options.map((option, index) => {
        const button = document.createElement('button');
        button.type = 'button'; button.id = `${view.model.id}-option-${index}`; button.className = 'desktop-select-option'; button.tabIndex = -1;
        button.dataset.optionIndex = String(index);
        button.setAttribute('role', 'option'); button.textContent = option.label;
        button.disabled = option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled);
        return button;
      });
      view.list.replaceChildren(...view.buttons);
      view.active = view.model.selectedIndex;
    }
    const selected = options[view.model.selectedIndex];
    // Captions can change language without replacing the control or its open/selected state.
    const label = Array.from(view.model.parentElement!.childNodes).filter(node => node !== view.model && node !== view.wrapper).map(node => node.textContent).join('').trim();
    const selectedLabel = selected?.label ?? this.emptyLabel();
    view.trigger.textContent = selectedLabel;
    view.trigger.setAttribute('aria-label', `${label}: ${selectedLabel}`);
    view.list.setAttribute('aria-label', label);
    view.trigger.disabled = view.model.disabled || view.buttons.every(button => button.disabled);
    for (let index = 0; index < view.buttons.length; index++) view.buttons[index]!.setAttribute('aria-selected', String(index === view.model.selectedIndex));
    if (view.trigger.disabled) this.close(view);
    else if (!view.list.hidden) this.markActive(view, view.active);
  }

  private open(view: SelectView, key?: NavigationKey): void {
    this.refreshView(view);
    if (view.trigger.disabled) return;
    this.closeAll(); view.list.hidden = false; view.trigger.setAttribute('aria-expanded', 'true');
    const disabled = view.buttons.map(button => button.disabled);
    const selected = view.model.selectedIndex;
    this.markActive(view, key === 'Home' || key === 'End' ? optionNavigationIndex(disabled, selected, key) : selected >= 0 && !disabled[selected] ? selected : optionNavigationIndex(disabled, -1, key ?? 'ArrowDown'));
  }

  private markActive(view: SelectView, index: number): void {
    view.active = index;
    for (let position = 0; position < view.buttons.length; position++) view.buttons[position]!.classList.toggle('focused-option', position === index);
    const button = view.buttons[index];
    if (button && !button.disabled) { button.focus({ preventScroll: true }); button.scrollIntoView({ block: 'nearest' }); }
  }

  private close(view: SelectView, focusTrigger = false): void {
    if (view.list.hidden) return;
    view.list.hidden = true; view.trigger.setAttribute('aria-expanded', 'false');
    if (focusTrigger && !view.trigger.disabled) view.trigger.focus({ preventScroll: true });
    else if (view.list.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  private choose(view: SelectView, index: number): void {
    if (this.disposed || view.model.disabled || view.buttons[index]?.disabled || !view.model.options[index]) return;
    view.model.selectedIndex = index;
    this.close(view, true); this.refreshView(view);
    view.model.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private onKey(view: SelectView, event: KeyboardEvent): void {
    // Focused HTML options must never reach wallpaper time/view shortcuts.
    event.stopPropagation();
    const key = event.key;
    if (key === 'Escape') { event.preventDefault(); this.close(view, true); return; }
    if (key === 'Tab') { this.close(view, true); return; }
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      event.preventDefault();
      if (view.list.hidden) this.open(view, key);
      else this.markActive(view, optionNavigationIndex(view.buttons.map(button => button.disabled), view.active, key));
    } else if ((key === 'Enter' || key === ' ') && !view.list.hidden) {
      event.preventDefault(); this.choose(view, view.active);
    }
  }
}
