import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';
import ChatDrawer from '@/components/ChatDrawer';
import FloatingChatButton from '@/components/FloatingChatButton';
import ErrorBoundary from '@/components/ErrorBoundary';
import Overview from '@/pages/Overview';
import Runs from '@/pages/Runs';
import RunDetail from '@/pages/RunDetail';
import Approvals from '@/pages/Approvals';
import Campaigns from '@/pages/Campaigns';
import MediaStudio from '@/pages/MediaStudio';
import Research from '@/pages/Research';
import Learnings from '@/pages/Learnings';
import Schedule from '@/pages/Schedule';
import Schedules from '@/pages/Schedules';
import Inbox from '@/pages/Inbox';
import Analytics from '@/pages/Analytics';
import Settings from '@/pages/Settings';
import Trash from '@/pages/Trash';
import BrandVoice from '@/pages/BrandVoice';
import Composer from '@/pages/Composer';
import Operations from '@/pages/Operations';

export default function App() {
  const [chatOpen, setChatOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 ml-60">
        <div className="p-8">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/runs" element={<Runs />} />
            <Route path="/runs/:id" element={<RunDetail />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/research" element={<Research />} />
            <Route path="/learnings" element={<Learnings />} />
            <Route path="/media-studio" element={<MediaStudio />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/schedules" element={<Schedules />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/trash" element={<Trash />} />
            <Route path="/brand" element={<BrandVoice />} />
            <Route path="/composer" element={<Composer />} />
            <Route path="/operations" element={<Operations />} />
          </Routes>
        </div>
      </main>
      <ErrorBoundary>
        <FloatingChatButton onClick={() => setChatOpen(true)} />
        <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
      </ErrorBoundary>
    </div>
  );
}
