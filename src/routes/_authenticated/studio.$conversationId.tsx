import { ChatWorkspace } from "@/components/studio/ChatWorkspace";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/studio/$conversationId")({
  component: ConversationPage,
});

function ConversationPage() {
  const { conversationId } = Route.useParams();
  return <ChatWorkspace key={conversationId} conversationId={conversationId} />;
}
