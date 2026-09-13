const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');
const webpack = require('webpack');

let rendererConfig = {
    mode: 'development',
    entry: './src/renderer/renderer.tsx',
    target: 'web',
    devtool: 'source-map',
    output: {
        filename: 'renderer.bundle.js',
        path: __dirname + '/dist',
    },
    resolve: {
        extensions: ['.js', '.json', '.ts', '.tsx'],
    },
    module: {
        rules: [
            {
                test: /\.(ts|tsx)$/,
                exclude: /node_modules/,
                use: {
                    loader: 'ts-loader',
                },
            },
            {
                test: /\.mjs$/,
                resolve: { fullySpecified: false },
            },
            {
                test: /\.css$/,
                use: [
                    'style-loader',
                    { loader: 'css-loader', options: { sourceMap: true } },
                ],
            },
            {
                test: /\.(jpg|png|svg|ico|icns)$/,
                type: 'asset/resource',
                generator: {
                    filename: '[path][name][ext]',
                },
            },
            {
                test: /\.(eot|ttf|woff|woff2)$/,
                type: 'asset/resource',
                generator: {
                    filename: '[path][name][ext]',
                },
            },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: path.resolve(__dirname, './src/renderer/index.html'),
        }),
        // Create a global variable at compile time
        new webpack.DefinePlugin({
            __VERSION__: JSON.stringify(require("./package.json").version),
            'process.platform': JSON.stringify('web'),
        })
    ],
};

module.exports = rendererConfig;