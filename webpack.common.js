const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');

module.exports = {
  entry: {
    app: './src/js/app.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    clean: true,
    filename: './js/app.js',
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader, // Extract CSS in production
          'css-loader',
        ],
      },
      {
        test: /\.(mp3|wav|ogg)$/, // Match audio file types
        type: 'asset/resource', // Use Webpack's asset/resource loader for static assets
        generator: {
          filename: 'audio/[name][ext]', // Output to 'dist/audio' directory
        },
      },
      {
        test: /\.csv$/, // Bundle CSV data files as raw strings
        type: 'asset/source', // Import the file contents directly as a string
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: 'css/[name].css', // Output CSS files
    }),
    new CopyPlugin({
      patterns: [
        { from: 'src/audio', to: 'audio' }, // Ensure all files in 'audio' are copied to 'dist/audio'
      ],
    }),
  ],
};
