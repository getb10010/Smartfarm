import { useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useTelegram } from './lib/TelegramProvider';

import Layout from './components/Layout/Layout';
import HomePage from './pages/HomePage';
import PoliciesPage from './pages/PoliciesPage';
import WeatherPage from './pages/WeatherPage';
import HistoryPage from './pages/HistoryPage';
import ProfilePage from './pages/ProfilePage';
import './App.css';

function App() {
  const { isTMA } = useTelegram();
  const navigate = useNavigate();
  const location = useLocation();

  // Telegram Mini App Back Button integration
  useEffect(() => {
    const webApp = (window as any).Telegram?.WebApp;
    if (!webApp) return;

    // Показываем BackButton на всех страницах кроме главной
    if (location.pathname !== '/') {
      webApp.BackButton?.show();
    } else {
      webApp.BackButton?.hide();
    }

    const handleBack = () => {
      navigate(-1);
    };

    webApp.BackButton?.onClick(handleBack);

    return () => {
      webApp.BackButton?.offClick(handleBack);
    };
  }, [location.pathname, navigate]);

  // Log TMA status
  useEffect(() => {
    if (isTMA) {
      console.log('[App] Running as Telegram Mini App ✅');
    } else {
      console.log('[App] Running in browser mode');
    }
  }, [isTMA]);

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route path="/weather" element={<WeatherPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Routes>
    </Layout>
  );
}

export default App;
