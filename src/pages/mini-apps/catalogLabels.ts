import { pickLocale } from '../../lib/miniAppLibrary';

// Headings and buttons of the listing dialog, in the languages of the listings.
const labels = {
  "en": { whatItDoes: "What it does", requirements: "Requirements", askAgent: "Try asking the agent", install: "Install", open: "Open" },
  "es": { whatItDoes: "Qué hace", requirements: "Requisitos", askAgent: "Pídeselo al agente", install: "Instalar", open: "Abrir" },
  "pt-BR": { whatItDoes: "O que faz", requirements: "Requisitos", askAgent: "Peça ao agente", install: "Instalar", open: "Abrir" },
  "zh-CN": { whatItDoes: "功能", requirements: "使用条件", askAgent: "试着问智能体", install: "安装", open: "打开" },
  "ja": { whatItDoes: "できること", requirements: "利用条件", askAgent: "エージェントへの依頼例", install: "インストール", open: "開く" },
  "ko": { whatItDoes: "주요 기능", requirements: "이용 조건", askAgent: "에이전트에게 요청 예시", install: "설치", open: "열기" },
  "de": { whatItDoes: "Funktionen", requirements: "Voraussetzungen", askAgent: "Beispiel für den Agenten", install: "Installieren", open: "Öffnen" },
  "fr": { whatItDoes: "Fonctions", requirements: "Prérequis", askAgent: "Exemple de demande à l’agent", install: "Installer", open: "Ouvrir" },
  "ru": { whatItDoes: "Возможности", requirements: "Что нужно", askAgent: "Попросите агента", install: "Установить", open: "Открыть" },
  "uk": { whatItDoes: "Можливості", requirements: "Що потрібно", askAgent: "Попросіть агента", install: "Встановити", open: "Відкрити" },
  "ar": { whatItDoes: "ما يقدّمه", requirements: "المتطلبات", askAgent: "اطلب من الوكيل", install: "تثبيت", open: "فتح" },
  "hi": { whatItDoes: "क्या कर सकते हैं", requirements: "ज़रूरतें", askAgent: "एजेंट से कहें", install: "इंस्टॉल करें", open: "खोलें" },
  "tr": { whatItDoes: "Neler yapar", requirements: "Gereksinimler", askAgent: "Ajana şunu sorun", install: "Yükle", open: "Aç" },
  "id": { whatItDoes: "Fungsinya", requirements: "Persyaratan", askAgent: "Coba minta ke agen", install: "Pasang", open: "Buka" },
  "vi": { whatItDoes: "Tính năng", requirements: "Yêu cầu", askAgent: "Thử nhờ agent", install: "Cài đặt", open: "Mở" },
  "th": { whatItDoes: "ทำอะไรได้", requirements: "สิ่งที่ต้องมี", askAgent: "ลองสั่งเอเจนต์", install: "ติดตั้ง", open: "เปิด" },
  "it": { whatItDoes: "Cosa fa", requirements: "Requisiti", askAgent: "Prova a chiedere all’agente", install: "Installa", open: "Apri" },
  "pl": { whatItDoes: "Co robi", requirements: "Wymagania", askAgent: "Poproś agenta", install: "Zainstaluj", open: "Otwórz" },
  "nl": { whatItDoes: "Wat het doet", requirements: "Vereisten", askAgent: "Vraag het de agent", install: "Installeren", open: "Openen" },
  "fa": { whatItDoes: "چه می‌کند", requirements: "پیش‌نیازها", askAgent: "از عامل بخواهید", install: "نصب", open: "باز کردن" },
} satisfies Record<string, Record<'whatItDoes' | 'requirements' | 'askAgent' | 'install' | 'open', string>>;

export type CatalogLabels = (typeof labels)['en'];
export function catalogLabels(): CatalogLabels {
  return labels[pickLocale(Object.keys(labels)) as keyof typeof labels] ?? labels.en;
}
