const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');
const webpack = require('webpack');

// terser-webpack-plugin ships with webpack 5. Cap minifier parallelism so
// low-RAM machines (e.g. 8 GB) don't run out of heap spawning one worker/CPU.
const TerserPlugin = require('terser-webpack-plugin');

const terserParallel = Math.max(1, Math.min(2, require('os').cpus().length - 1));

let rendererConfig = {
    mode: 'production',
    entry: './src/renderer/renderer.tsx',
    target: 'web',
    output: {
        filename: 'renderer.bundle.js',
        path: __dirname + '/dist',
    },
    resolve: {
        extensions: ['.js', '.json', '.ts', '.tsx'],
    },
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({ parallel: terserParallel }),
        ],
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
        new webpack.DefinePlugin({
            __VERSION__: JSON.stringify(require("./package.json").version),
            'process.platform': JSON.stringify('web'),
            'process.env.DRAGGABLE_DEBUG': JSON.stringify(''),
        })
    ],
};

module.exports = rendererConfig;