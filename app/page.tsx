import type { Metadata } from "next";
import { GenesisCalendar } from "./GenesisCalendar";

export const metadata: Metadata = {
  title: "Genesis Tasker",
  description:
    "GENESIS — календарь задач и менеджер проектов с планом дня, напоминаниями и синхронизацией Google Calendar.",
};

export default function Home() {
  return <GenesisCalendar />;
}
