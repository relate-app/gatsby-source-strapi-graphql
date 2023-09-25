# CHANGELOG.md

## 6.1.0 (2023-09-25)

Features:

  - Added support for filtering specific file types on extension using the option: `{ download: ['svg', 'pdf'] }`

## 6.0.0 (2023-09-25)

Features:

  - add support for remote transformation -> [@imgix/gatsby](https://github.com/imgix/gatsby) using config: 
  ```js
  {
      resolve: `@imgix/gatsby`,
      options: {
        // This is the domain of your imgix source, which can be created at
        // https://dashboard.imgix.com/.
        // Required for "Web Proxy" imgix sources.
        domain: 'example.imgix.net',

        // This is the source's secure token. Can be found under the "Security"
        // heading in your source's configuration page, and revealed by tapping
        // "Show Token". Required for web-proxy sources.
        secureURLToken: 'xxx',

        // This configures the plugin to work in WebFolder mode.
        // Can be AmazonS3, GoogleCloudStorage, MicrosoftAzure, or WebFolder.
        sourceType: ImgixSourceType.WebFolder,

        // These are some default imgix parameters to set for each image. It is
        // recommended to have at least this minimal configuration.
        defaultImgixParams: { auto: 'format,compress' },

        // This configures which nodes to modify.
        fields: [
          // Add an object to this array for each node type you want to modify. Follow the instructions below for this.
          {
            nodeType: 'StrapiUploadFile',
            rawURLKey: 'url',
            fieldName: 'imgixImage',
          },
        ],
      },
    },
  ```
  - Opionally download images, with the new plugin option: **download** defaulting to all, to enable faster sourcing and remote transformations.

Breaking changes:

  - Changed type of inline images using markdown or html in {field}_images from File to StrapiUploadImage. This means you can now get captions, alternativeText for the files in markdown from Strapi, and you can use tools like [@imgix/gatsby](https://github.com/imgix/gatsby) to transform files on-demand instead and with that improving performance. **This will require you to update your queries.**
  - New option **download**, will need to be true when using sharp transformation of images.
  - On the type StrapiUploadFile, the field file will be null when download is false.
