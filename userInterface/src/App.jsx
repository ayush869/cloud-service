import { useState } from 'react';
import AdminDashboard from './components/admin/AdminDashboard';
import AuthModal from './components/auth/AuthModal';
import Footer from './components/layout/Footer';
import Header from './components/layout/Header';
import AboutSection from './components/sections/AboutSection';
import ContactSection from './components/sections/ContactSection';
import HeroSection from './components/sections/HeroSection';
import ServicesSection from './components/sections/ServicesSection';
import './App.css';

export default function App() {
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const handleAuthSuccess = (role) => {
    setCurrentUser({ role, name: role === 'admin' ? 'Admin' : 'User' });
    setIsAuthOpen(false);
  };

  if (currentUser?.role === 'admin') {
    return <AdminDashboard onLogout={() => setCurrentUser(null)} />;
  }

  return (
    <>
      <Header onLoginClick={() => setIsAuthOpen(true)} />
      <main>
        <HeroSection onLoginClick={() => setIsAuthOpen(true)} />
        <ServicesSection />
        <AboutSection />
        <ContactSection />
      </main>
      <Footer />
      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} onAuthSuccess={handleAuthSuccess} />
    </>
  );
}
