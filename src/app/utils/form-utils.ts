const owasp = require('owasp-password-strength-test');
const sharp = require('sharp');

export function defaultString(value: any, defaultValue?: string): string {
  if (!value || typeof value != "string")
    return defaultValue;
  return value;
}

export function requiredString(value: any): string {
  if (!value)
    throw new Error(`required string was not found: ${value}`);
  if (typeof value != "string")
    throw new Error(`required string was not a string value, type=${typeof value}, value=${value}`);
  return value;
}

export function resizeImage(path: string, width: number, height?: number) {
  const outputPath = path + ".resized.png";
  return sharp(path)
    .resize(width, height)
    .png()
    .toFile(outputPath)
    .then(function () {
      console.log("Resized image: " + outputPath);
      return outputPath;
    });
}

export function groupByPrefix(fields: any, prefix: string) {
  return Object.keys(fields)
    .filter(f => f.length > prefix.length && f.substring(0, prefix.length) == prefix)
    .filter(f => fields[f])
    .map(f => f.substring(prefix.length))
    .reduce((o, k) => {
      o[k] = fields[prefix + k];
      return o;
    }, {});
}

export function extractRecipients(fields: any) {
  const prefix = "recipient";
  const recipientMap = {};
  Object.keys(fields)
    .filter(f => f.length > prefix.length && f.substring(0, prefix.length) == prefix)
    .forEach(f => {
      const groupName = f.substring(0, f.indexOf('.'))
      const field = f.substr(f.indexOf('.') + 1, f.length);
      const group = recipientMap[groupName] || {};
      const value = fields[f];
      group[field] = value;
      recipientMap[groupName] = group;
    })

  const output = {
    contributors: [],
    royalties: [],
    invalid: []
  };
  Object.keys(recipientMap)
    .map(key => recipientMap[key])
    .map(recipient => this.convertToRoyaltyOrContributor(recipient))
    .forEach(r => {
      if (r.valid) {
        if (r.isFixedAmount) output.royalties.push(r);
        else output.contributors.push(r);
      }
      else {
        output.invalid.push(r);
      }
    })
  return output;
}

export function convertToRoyaltyOrContributor(recipient) {
  let value = recipient.value;
  if (value) {
    value = value.toLowerCase().trim();
    try {
      return {
        valid: true,
        isFixedAmount: false,
        address: recipient.address,
        shares: parseInt(value)
      }
    }
    catch (e) {
      return {
        isFixedAmount: false,
        valid: false,
        input: recipient
      }
    }
  }
  return {
    isFixedAmount: false,
    valid: false,
    input: recipient
  };
}

export function checkPasswordStrength(pwd): string {
  owasp.config({
    allowPassphrases: false,
    maxLength: 64,
    minLength: 10,
    minOptionalTestsToPass: 4,
  });

  var result = owasp.test(pwd);
  return pwd && result.errors.length == 0 ? null : result.errors;
}

export function validateEmail(email) {
  var re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(email);
}
