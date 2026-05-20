/**
 * Floating "Chat with {agent.name}" button — fixed bottom-right.
 *
 * Uses the operator-chosen emoji as the avatar (from agent_profile.name's
 * leading emoji), shows the agent's name, and reflects model + ready state.
 */

import { MessageCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

export default function FloatingChatButton({ onClick }: { onClick: () => void }) {
  const { data } = useQuery<{ profile: { name: string; default_model: string } } | null>({
    queryKey: ['agent-profile'],
    queryFn: async () => {
      const r = await fetch('/api/social/agent/profile');
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const fullName = data?.profile?.name ?? 'Agent';
  const m = fullName.match(/^(\p{Extended_Pictographic})\s+(.*)$/u);
  const emoji = m?.[1];
  const name = m?.[2] ?? fullName;

  return (
    <button
      onClick={onClick}
      aria-label={`Chat with ${name}`}
      className="group fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-full bg-gradient-to-r from-brand-cyan to-brand-purple px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-brand-purple/30 hover:shadow-xl hover:scale-[1.03] hover:shadow-brand-purple/50 transition-all"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-base">
        {emoji ?? <MessageCircle className="h-4 w-4" />}
      </span>
      <span className="pr-1">Chat with {name}</span>
    </button>
  );
}
