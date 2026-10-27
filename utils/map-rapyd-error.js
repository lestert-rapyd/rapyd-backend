// Friendly copy for the Rapyd error codes the demo hits most. Anything not
// listed here falls back to Rapyd's own error_code/message (see http.js
// sendError) rather than a generic "unknown error".
const errorMap = {
  'ERROR_PROCESSING_CARD - [05]': {
    code: 'DO_NOT_HONOR',
    message: 'Your card was declined by the bank.',
    hint: 'Try a different card or contact your bank for more details.'
  },
  'INVALID_PAYMENT_METHOD_TYPE': {
    code: 'INVALID_METHOD',
    message: 'The selected payment method is not supported.',
    hint: 'Check if you selected the correct card type for your country.'
  },
  'CARD_NUMBER_INVALID': {
    code: 'INVALID_CARD_NUMBER',
    message: 'The card number entered is invalid.',
    hint: 'Double-check the card number and try again.'
  },
  'CARD_EXPIRED': {
    code: 'EXPIRED_CARD',
    message: 'The card has expired.',
    hint: 'Use a card with a valid expiration date.'
  },
  'INSUFFICIENT_FUNDS': {
    code: 'NO_FUNDS',
    message: 'Not enough funds on the card.',
    hint: 'Use another card or fund the account.'
  }
  // Add more as needed
};

/** The mapping for a Rapyd error_code, or null when there is none. */
export function findRapydError(errorCode = '') {
  return Object.hasOwn(errorMap, errorCode) ? errorMap[errorCode] : null;
}

/** Back-compat: always returns a mapping (generic UNKNOWN_ERROR fallback). */
export function mapRapydError(errorCode = '') {
  return findRapydError(errorCode) || {
    code: 'UNKNOWN_ERROR',
    message: 'An unknown error occurred during payment.',
    hint: 'Please try again or contact support.'
  };
}
