export const internalErrorMessage = "Something went wrong on our side. The NextBrowser team is working on it.";

export function internalError(action?: string): string {
  const context = action?.trim();
  return context ? `${context} ${internalErrorMessage}` : internalErrorMessage;
}

export function needsSupportLink(message: string): boolean {
  return message.includes(internalErrorMessage);
}
