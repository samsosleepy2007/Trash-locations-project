import {createRoot} from 'react-dom/client';
import ActivityPage from './ActivityPage';
import AdminPage from './AdminPage';
import './activities.css';
createRoot(document.getElementById('activity-root')).render(location.pathname.endsWith('admin.html')?<AdminPage/>:<ActivityPage/>);
