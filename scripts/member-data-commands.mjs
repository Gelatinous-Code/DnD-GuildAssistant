export const memberDataCommands = [
  {
    name: "member-data",
    description: "Preview and export one verified guild member's data.",
    type: 1,
    default_member_permissions: "32",
    options: [
      {
        type: 1,
        name: "preview",
        description: "Inspect record classes and create a revision without changing data.",
        options: [
          {
            type: 6,
            name: "member",
            description: "Current guild member whose records should be inventoried.",
            required: true,
          },
          {
            type: 3,
            name: "action",
            description: "Policy treatment to preview; neither choice changes data.",
            required: true,
            choices: [
              { name: "Export", value: "export" },
              { name: "Departure", value: "departure" },
            ],
          },
        ],
      },
      {
        type: 1,
        name: "export",
        description: "Download the exact private snapshot approved by a recent preview.",
        options: [
          {
            type: 6,
            name: "member",
            description: "Current guild member whose private export should be generated.",
            required: true,
          },
          {
            type: 3,
            name: "revision",
            description: "Complete 64-character revision shown by member-data preview.",
            required: true,
            min_length: 64,
            max_length: 64,
          },
        ],
      },
      {
        type: 1,
        name: "status",
        description: "Show safe status metadata for one member export operation.",
        options: [
          {
            type: 3,
            name: "operation",
            description: "Operation ID returned by member-data export or retry.",
            required: true,
            min_length: 1,
            max_length: 100,
          },
        ],
      },
      {
        type: 1,
        name: "retry",
        description: "Retry a failed member export against its original revision.",
        options: [
          {
            type: 3,
            name: "operation",
            description: "Failed operation ID returned by member-data export.",
            required: true,
            min_length: 1,
            max_length: 100,
          },
        ],
      },
    ],
  },
];
