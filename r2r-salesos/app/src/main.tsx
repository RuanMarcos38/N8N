import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Login from './Login';
import './index.css';
createRoot(document.getElementById('root')!).render(<StrictMode>{location.pathname==='/login'?<Login/>:<App/>}</StrictMode>);
