import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './styles.css';

const ROOT_ID = 'cowrite-extension-root';

function mount(): void {
  if (document.getElementById(ROOT_ID)) return;
  const root = document.createElement('div');
  root.id = ROOT_ID;
  document.body.append(root);
  createApp(App).use(createPinia()).mount(root);
  addSettingsLauncher();
}

function addSettingsLauncher(attempt = 0): void {
  if (document.getElementById('cowrite-settings-launcher')) return;
  const settingsRoot = document.querySelector('#extensions_settings2, #extensions_settings');
  if (!settingsRoot) {
    if (attempt < 30) window.setTimeout(() => addSettingsLauncher(attempt + 1), 1000);
    return;
  }
  const section = document.createElement('div');
  section.id = 'cowrite-settings-launcher';
  section.className = 'cowrite-settings-launcher';
  const text = document.createElement('span');
  text.textContent = '共笔：和当前角色一起记录问卷与日记';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu_button';
  button.textContent = '打开共笔';
  button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('cowrite:open')));
  section.append(text, button);
  settingsRoot.append(section);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
