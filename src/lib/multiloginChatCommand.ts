const MOBILE_START_REQUEST = /^(?:запусти|включи|стартани)\s+(?:(?:выбранн(?:ый|ую)|этот|эту)\s+)?(?:(?:профиль|клаудфон|телефон)(?:\s+мультилогина)?|multilogin\s+(?:cloud\s+phone|profile)|(?:multilogin\s+)?cloud\s+phone)(?:\s+выбранн(?:ый|ую))?$|^(?:start|launch|turn\s+on)\s+(?:(?:the\s+)?selected\s+|this\s+)?(?:multilogin\s+)?(?:cloud\s+phone|profile)$/i;

export function isMultiloginMobileStartRequest(text: string): boolean {
  const normalized = text.trim().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  return MOBILE_START_REQUEST.test(normalized);
}

export function multiloginMobileStartReply(name: string, status: string, russian: boolean): string {
  if (russian) {
    return status === "started"
      ? `Cloud phone «${name}» уже запущен.`
      : `Запуск cloud phone «${name}» отправлен.`;
  }
  return status === "started"
    ? `Cloud phone “${name}” is already running.`
    : `Cloud phone “${name}” is starting.`;
}
