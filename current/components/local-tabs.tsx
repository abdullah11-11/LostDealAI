"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type LocalTab = {
  id: string;
  label: string;
  content: ReactNode;
};

export function LocalTabs({ tabs, label, defaultTab }: { tabs: LocalTab[]; label: string; defaultTab?: string }) {
  const firstTab = tabs[0]?.id ?? "";
  const [activeTab, setActiveTab] = useState(defaultTab && tabs.some((tab) => tab.id === defaultTab) ? defaultTab : firstTab);
  const instanceId = useId().replace(/:/g, "");
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function selectByIndex(index: number) {
    const normalized = (index + tabs.length) % tabs.length;
    const next = tabs[normalized];
    if (!next) return;
    setActiveTab(next.id);
    buttons.current[normalized]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectByIndex(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectByIndex(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectByIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectByIndex(tabs.length - 1);
    }
  }

  if (!tabs.length) return null;

  return (
    <div>
      <div className="overflow-x-auto">
        <div role="tablist" aria-label={label} className="flex min-w-max gap-1 rounded-xl border border-line bg-panel-raised p-1">
          {tabs.map((tab, index) => {
            const selected = activeTab === tab.id;
            const tabId = `${instanceId}-${tab.id}-tab`;
            const panelId = `${instanceId}-${tab.id}-panel`;
            return (
              <button
                key={tab.id}
                ref={(element) => { buttons.current[index] = element; }}
                id={tabId}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={`min-h-9 rounded-lg px-3.5 text-sm font-bold transition-colors ${selected ? "bg-panel text-content shadow-sm ring-1 ring-line" : "text-secondary hover:bg-panel-hover hover:text-content"}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      {tabs.map((tab) => {
        const selected = activeTab === tab.id;
        return (
          <div
            key={tab.id}
            id={`${instanceId}-${tab.id}-panel`}
            role="tabpanel"
            aria-labelledby={`${instanceId}-${tab.id}-tab`}
            tabIndex={0}
            hidden={!selected}
            className="mt-5 focus-visible:rounded-xl"
          >
            {tab.content}
          </div>
        );
      })}
    </div>
  );
}
