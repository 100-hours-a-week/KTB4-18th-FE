import { createRoot } from 'react-dom/client';
import { ChatEntryPage } from '../../src/features/chat-entry/components/ChatEntryPage';
import { setAccessToken } from '../../src/features/auth-login/api/authSession';
import './chatMusicReleaseLocation';
import '../../src/index.css';
import '../../src/App.css';

setAccessToken(window.musicRelease.token);
createRoot(document.getElementById('root')!).render(<ChatEntryPage />);
