import { Router } from './router';
import { renderLogin } from './pages/login';
import { renderChat } from './pages/chat';
import { renderChannels } from './pages/channels';

const router = new Router('app');

router.add('login', renderLogin);
router.add('channels', renderChannels);
router.add('chat', renderChat);

// Start on login if no token, otherwise channels
const token = localStorage.getItem('token');
router.navigate(token ? 'channels' : 'login');
