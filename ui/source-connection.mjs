/** A new simulator response must never reuse the previous workspace's authority. */
export const responseReadOnly = connection => connection?.state === 'requires_new_response';
export const responseReadOnlyMessage = 'The connected simulator started a new response. Previous records are preserved. Ask your workspace administrator to start a fresh response workspace.';
export const responseReadOnlyHeading = 'This response is read-only.';

export function responseBoundaryNotice(connection, escape) {
  return responseReadOnly(connection) ? `<section class="source-boundary-notice" role="status"><strong>${responseReadOnlyHeading}</strong><p>${escape(responseReadOnlyMessage)}</p></section>` : '';
}

const operationalActions = new Set(['edit-response', 'operational-draft', 'addresource', 'reviewapprove', 'reviewreject', 'reviewclarify', 'sync', 'automation', 'investigate', 'investigatesignal', 'investigate-facility', 'repair', 'stop-inquiry', 'lookup', 'reserve', 'share', 'revoke', 'withdraw', 'confirmcommitment', 'publish', 'publishconfirm', 'queue-as-observation', 'flush', 'discover-page', 'interpret-page', 'verifyneed']);
export const responseActionWrites = action => operationalActions.has(action);

export function protectPreviousResponse(root, connection) {
  if (!responseReadOnly(connection)) return;
  for (const control of root.querySelectorAll('[data-action]')) {
    if (responseActionWrites(control.dataset.action)) {
      control.disabled = true;
      control.title = responseReadOnlyHeading;
    }
  }
  for (const form of root.querySelectorAll('form:not(#loginform):not(#trackingform)')) {
    for (const button of form.querySelectorAll('button[type="submit"],button:not([type]),input[type="submit"]')) {
      button.disabled = true;
      button.title = responseReadOnlyHeading;
    }
  }
}
