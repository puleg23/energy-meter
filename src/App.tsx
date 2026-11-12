import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from './firebase';
import { useMeter } from './hooks/useMeter';
import { HomeView } from './components/views/HomeView';
import { CostView } from './components/views/CostView';
import { BatchView } from './components/views/BatchView';
import { LimitsView } from './components/views/LimitsView';
import { GraphsView } from './components/views/GraphsView';
import { Navigation, Sidebar } from './components/Navigation';
import { Brand } from './components/Logo';
import { SetupModal } from './components/SetupModal';
import { Login } from './components/Login';
import { ActiveTab } from './types';

const TABS: ActiveTab[] = ['home', 'cost', 'batch', 'limits', 'graphs'];
const readHash = (): ActiveTab => {
  const h = window.location.hash.replace('#', '') as ActiveTab;
  return TABS.includes(h) ? h : 'home';
};

function Signed({ user }: { user: User }) {
  const m = useMeter();
  const [tab, setTab] = useState<ActiveTab>(readHash);
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    const on = () => setTab(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (t: ActiveTab) => { setTab(t); window.location.hash = t; };

  return (
    <div className="lg:flex lg:min-h-screen">
      <Sidebar currentTab={tab} onTabChange={go} brand={<Brand size={38} />} online={m.online} email={user.email}
        onSignOut={() => signOut(auth)} onSetup={() => setSetupOpen(true)} />
      <main className="flex-1 w-full max-w-md mx-auto px-4 sm:px-5 lg:max-w-none lg:mx-0 lg:ml-64 lg:px-10 xl:px-14">
        <div className="lg:max-w-6xl lg:mx-auto">
        {tab === 'home' && <HomeView m={m} onOpenSetup={() => setSetupOpen(true)} />}
        {tab === 'cost' && <CostView m={m} />}
        {tab === 'batch' && <BatchView m={m} />}
        {tab === 'limits' && <LimitsView m={m} />}
        {tab === 'graphs' && <GraphsView m={m} />}
        <button onClick={() => signOut(auth)} className="lg:hidden text-xs text-[#555555] underline min-h-11 mt-2 mb-20">Sign out ({user.email})</button>
        </div>
      </main>
      <SetupModal open={setupOpen} onClose={() => setSetupOpen(false)} />
      <Navigation currentTab={tab} onTabChange={go} />
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  return (
    <div className="min-h-screen bg-[#f4f5f7]">
      {user === undefined ? <p className="pt-20 text-center text-[#555555] w-full">Loading...</p> : user ? <Signed user={user} /> : <Login />}
    </div>
  );
}
