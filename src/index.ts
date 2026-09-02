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
  addWandLauncher();
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
  section.className = 'inline-drawer';
  const header = document.createElement('div');
  header.className = 'inline-drawer-toggle inline-drawer-header';
  const title = document.createElement('b');
  title.textContent = '共笔';
  const icon = document.createElement('div');
  icon.className = 'inline-drawer-icon fa-solid fa-circle-chevron-down down';
  header.append(title, icon);
  const content = document.createElement('div');
  content.className = 'inline-drawer-content';
  const text = document.createElement('p');
  text.textContent = '与当前角色在独立工作区填写问卷、互评和交换日记；不会向聊天楼层写入内容。';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu_button';
  button.textContent = '打开共笔';
  button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('cowrite:open')));
  content.append(text, button);
  section.append(header, content);
  settingsRoot.append(section);
}

function addWandLauncher(attempt = 0): void {
  if (document.getElementById('cowrite-wand-launcher')) return;
  const menu = document.querySelector('#extensionsMenu');
  if (!menu) {
    if (attempt < 30) window.setTimeout(() => addWandLauncher(attempt + 1), 1000);
    return;
  }
  const container = document.createElement('div');
  container.className = 'extension_container';
  const item = document.createElement('div');
  item.id = 'cowrite-wand-launcher';
  item.className = 'list-group-item flex-container flexGap5 interactable';
  item.tabIndex = 0;
  item.setAttribute('role', 'listitem');
  const icon = document.createElement('div');
  icon.className = 'fa-fw fa-solid fa-book-open extensionsMenuExtensionButton';
  const label = document.createElement('span');
  label.textContent = '共笔';
  const open = () => window.dispatchEvent(new CustomEvent('cowrite:open'));
  item.addEventListener('click', open);
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') open();
  });
  item.append(icon, label);
  container.append(item);
  menu.append(container);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
