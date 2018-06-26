module.exports = {
    "extends": "airbnb-base",
    rules: {
      "no-console": ["off"],
      "no-use-before-define": ["error", { "functions": false, "classes": false }],
      semi: [2, "never"],
      "prefer-destructuring": ["off"],
    },
};
