/** Закачва се на request-а от SecureLinkMiddleware — аналог на req.user за JWT. */
export interface SecureLinkRequestContext {
  id: string;
  loanApplicationId: string;
  clientId: string | null;
  familyMemberId: string | null;
}
