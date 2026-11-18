import { NewChatButton } from '@renderer/components/Conversation/NewChatButton';
import logo from '@resources/logo-vector.svg?url';

export default function Home() {
  return (
    <section className="cyrvis-home" aria-labelledby="welcome-title">
      <div className="cyrvis-welcome">
        <img className="cyrvis-welcome-logo" src={logo} alt="" />
        <h1 id="welcome-title">Welcome to Cyrvis</h1>
        <p>Every conversation. Every task. All in one place.</p>
        <span>Start a new chat or revisit a conversation from History.</span>
        <NewChatButton className="mt-6" />
      </div>
      <p className="cyrvis-welcome-footer">
        Close this window. Cyrvis stays by your side.
      </p>
    </section>
  );
}
