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

export function mapRapydError(errorCode = '') {
  return errorMap[errorCode] || {
    code: 'UNKNOWN_ERROR',
    message: 'An unknown error occurred during payment.',
    hint: 'Please try again or contact support.'
  };
}
