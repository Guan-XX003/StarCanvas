import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Ellipsis, Eraser, Pencil, Trash2 } from "lucide-react";

type AgentCardMenuProps = {
  agent: any;
  activeView: string;
  t: (text: string) => string;
  onEdit: (agent: any) => void;
  onDuplicate: (agent: any) => void;
  onClearConversation: (agent: any) => void;
  onDelete: (agent: any) => void;
};

/** Independent sibling of the card button: never nest interactive controls. */
export function AgentCardMenu({ agent, activeView, t, onEdit, onDuplicate, onClearConversation, onDelete }: AgentCardMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    const margin = 8;
    const preferredLeft = anchor.right + 6;
    setPosition({
      left: Math.max(margin, Math.min(preferredLeft, window.innerWidth - menu.width - margin)),
      top: Math.max(margin, Math.min(anchor.top, window.innerHeight - menu.height - margin)),
    });
    menuRef.current.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => { if (activeView !== "agents") setOpen(false); }, [activeView]);

  const run = (action: (agent: any) => void) => {
    setOpen(false);
    action(agent);
  };
  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") || []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
      (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };
  const actions = [
    { label: "编辑配置", icon: Pencil, action: onEdit },
    { label: "复制智能体", icon: Copy, action: onDuplicate },
    { label: "清空聊天记录", icon: Eraser, action: onClearConversation },
    { label: "删除智能体", icon: Trash2, action: onDelete, danger: true },
  ];

  return <>
    <button ref={triggerRef} type="button" className="wanjuan-agent-card-menu-trigger"
      aria-label={`${t("更多操作")}：${agent.name || t("智能体")}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen((value) => !value)}>
      <Ellipsis size={18} aria-hidden="true" />
    </button>
    {open && createPortal(
      <div ref={menuRef} id={menuId} role="menu" aria-label={`${agent.name || t("智能体")} · ${t("更多操作")}`}
        className="wanjuan-agent-card-menu" style={{ left: position.left, top: position.top }} onKeyDown={onMenuKeyDown}>
        {actions.map(({ label, icon: Icon, action, danger }) =>
          <button key={label} type="button" role="menuitem" className={`wanjuan-agent-card-menu-item${danger ? " wanjuan-agent-card-menu-item-danger" : ""}`}
            onClick={() => run(action)}><Icon size={16} aria-hidden="true" /><span>{t(label)}</span></button>
        )}
      </div>, document.body,
    )}
  </>;
}
