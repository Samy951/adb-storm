import { el, text, btn } from '../dom';
import { getChannels, createChannel, joinChannel } from '../api';
import type { Router } from '../router';
import { renderCreateChannelDialog } from '../components/create-channel';
import { renderSidebar } from '../components/sidebar';
import { renderAppHeader } from '../components/header';
import { renderAppFooter } from '../components/footer';

export function renderChannels(container: HTMLElement) {
  const router = (window as any).__router as Router;

  // Auth guard
  if (!localStorage.getItem('token')) {
    router.navigate('login');
    return;
  }

  const layout = el('div', { className: 'app-layout' });

  // Header
  layout.appendChild(renderAppHeader('Channel Browser'));

  // Body = sidebar + main content
  const body = el('div', { className: 'app-body' });

  body.appendChild(renderSidebar('channels'));

  // Main content
  const main = el('div', { className: 'main-content' });
  const browser = el('div', { className: 'channel-browser' });
  const window_ = el('div', { className: 'win-window channel-browser__window' });

  // Window title bar
  const winTitle = el('div', { className: 'win-titlebar', style: 'background: var(--navy-light)' },
    el('div', { className: 'win-titlebar__title' },
      text('span', '', '⊞'),
      text('span', '', 'Channel Browser')
    ),
  );

  // Toolbar
  const toolbar = el('div', { className: 'channel-browser__toolbar' },
    el('div', {},
      btn('← Back', 'win-btn', () => {}),
      btn('→ Forward', 'win-btn', () => {})
    ),
    el('div', { className: 'channel-browser__address' },
      text('span', 'channel-browser__address-label', 'Address:'),
      text('span', 'channel-browser__address-value font-mono', 'messenger://root/channels/global')
    )
  );

  // Grid area
  const grid = el('div', { className: 'channel-browser__grid' });
  const resultsInfo = text('div', '', 'Loading channels...');
  const tableContainer = el('div');

  // Error display (replaces alert())
  const errorMsg = text('div', 'win-error', '');

  // Controls
  const controls = el('div', { className: 'channel-browser__controls' },
    el('div', {},
      btn('CREATE NEW', 'win-btn win-btn--bold', () => showCreateDialog()),
    ),
    text('span', '', '')
  );

  grid.appendChild(resultsInfo);
  grid.appendChild(errorMsg);
  grid.appendChild(tableContainer);
  grid.appendChild(controls);

  window_.appendChild(winTitle);
  window_.appendChild(toolbar);
  window_.appendChild(grid);

  browser.appendChild(window_);
  main.appendChild(browser);
  body.appendChild(main);

  layout.appendChild(body);
  layout.appendChild(renderAppFooter());

  container.appendChild(layout);

  // Create channel dialog
  const showCreateDialog = () => {
    const overlay = renderCreateChannelDialog(async (name, desc, isPrivate) => {
      try {
        await createChannel(name, desc, isPrivate);
        overlay.remove();
        errorMsg.textContent = '';
        loadChannels();
      } catch (err: any) {
        errorMsg.textContent = `Error: ${err.message}`;
      }
    }, () => overlay.remove());
    container.appendChild(overlay);
  };

  // Load channels
  const loadChannels = async () => {
    try {
      const channels = await getChannels();
      resultsInfo.textContent = `Results: ${channels.length} channels found in the global index.`;

      // Clear table
      while (tableContainer.firstChild) {
        tableContainer.removeChild(tableContainer.firstChild);
      }

      const table = document.createElement('table');
      table.className = 'win-table';

      // Header
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      for (const col of ['Channel Name', 'Description', 'Action']) {
        const th = document.createElement('th');
        th.textContent = col;
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      table.appendChild(thead);

      // Body
      const tbody = document.createElement('tbody');
      for (const ch of channels) {
        const tr = document.createElement('tr');

        const tdName = document.createElement('td');
        tdName.className = 'channel-name';
        tdName.textContent = `#${ch.name}`;
        tr.appendChild(tdName);

        const tdDesc = document.createElement('td');
        tdDesc.textContent = ch.description || '';
        tdDesc.style.color = 'var(--text-light)';
        tr.appendChild(tdDesc);

        const tdAction = document.createElement('td');
        const joinBtn = btn('JOIN', 'win-btn win-btn--bold win-btn--small', async () => {
          try {
            await joinChannel(ch.id);
          } catch (err: any) {
            // 409/conflict = already a member, safe to continue
            // Other errors = show and stop
            const msg = err.message || '';
            if (!msg.includes('already') && !msg.includes('conflict')) {
              errorMsg.textContent = `Error joining #${ch.name}: ${msg}`;
              return;
            }
          }
          router.navigate('chat', { channel: ch.id, name: ch.name });
        });
        tdAction.appendChild(joinBtn);
        tr.appendChild(tdAction);

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      tableContainer.appendChild(table);
    } catch (err: any) {
      resultsInfo.textContent = `Error loading channels: ${err.message}`;
    }
  };

  loadChannels();
}
