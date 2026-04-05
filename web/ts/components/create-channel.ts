import { el, text, input, btn } from '../dom';

export function renderCreateChannelDialog(
  onSubmit: (name: string, description: string, isPrivate: boolean) => void,
  onCancel: () => void
): HTMLElement {
  const overlay = el('div', { className: 'dialog-overlay' });

  const dialog = el('div', { className: 'win-window create-channel-dialog' });

  // Title bar
  const titlebar = el('div', { className: 'win-titlebar' },
    el('div', { className: 'win-titlebar__title' },
      text('span', '', '▣'),
      text('span', '', 'Create New Channel')
    ),
    el('div', { className: 'win-titlebar__controls' },
      btn('×', 'win-titlebar__btn', onCancel)
    )
  );

  // Content
  const content = el('div', { className: 'create-channel-dialog__content' });

  // Channel name
  const nameInput = input('text', 'win-input', 'e.g. #general');
  const nameField = el('div', { className: 'create-channel-dialog__field' },
    text('label', '', 'Channel Name:'),
    nameInput
  );

  // Description
  const descTextarea = document.createElement('textarea');
  descTextarea.className = 'win-textarea';
  descTextarea.placeholder = 'Enter channel purpose...';
  descTextarea.rows = 3;

  const descField = el('div', { className: 'create-channel-dialog__field' },
    text('label', '', 'Description:'),
    descTextarea
  );

  // Privacy radio buttons
  const radioPublic = document.createElement('input');
  radioPublic.type = 'radio';
  radioPublic.name = 'privacy';
  radioPublic.checked = true;

  const radioPrivate = document.createElement('input');
  radioPrivate.type = 'radio';
  radioPrivate.name = 'privacy';

  const privacyField = el('div', { className: 'create-channel-dialog__field' },
    text('label', '', 'Accessibility:'),
    el('label', { className: 'win-radio' },
      radioPublic,
      text('span', '', 'Public (Visible to all users)')
    ),
    el('label', { className: 'win-radio' },
      radioPrivate,
      text('span', '', 'Private (Invite only)')
    )
  );

  // Separator
  const separator = el('div', { className: 'win-separator' });

  // Actions
  const actions = el('div', { className: 'create-channel-dialog__actions' },
    btn('OK', 'win-btn', () => {
      const name = nameInput.value.trim().replace(/^#/, '');
      const desc = descTextarea.value.trim();
      if (!name) return;
      onSubmit(name, desc, radioPrivate.checked);
    }),
    btn('Cancel', 'win-btn', onCancel)
  );

  content.appendChild(nameField);
  content.appendChild(descField);
  content.appendChild(privacyField);
  content.appendChild(separator);
  content.appendChild(actions);

  dialog.appendChild(titlebar);
  dialog.appendChild(content);

  overlay.appendChild(dialog);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) onCancel();
  });

  return overlay;
}
