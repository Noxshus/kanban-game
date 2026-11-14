import type { GameState } from '../game/types'

export const exampleGameState: GameState = {
  randomState: 1,
  simulationTime: 0,
  developers: [
    {
      id: 'developer-1',
      name: 'Alex',
      activeTicketID: 'ticket-1',
      productivity: 1,
    },
    {
      id: 'developer-2',
      name: 'Sam',
      activeTicketID: 'ticket-2',
      productivity: 1.2,
    },
    {
      id: 'developer-3',
      name: 'Jordan',
      productivity: 0.8,
    },
  ],
  tickets: [
    {
      id: 'ticket-1',
      title: 'Build the navigation menu',
      actualStatus: 'in_progress',
      reportedStatus: 'in_progress',
      assignedDeveloperId: 'developer-1',
      requiredWork: 10,
      completedWork: 4,
      reportedProgress: 40,
    },
    {
      id: 'ticket-2',
      title: 'Fix the search filter',
      actualStatus: 'in_progress',
      reportedStatus: 'todo',
      assignedDeveloperId: 'developer-2',
      requiredWork: 8,
      completedWork: 2,
      reportedProgress: 25,
    },
    {
      id: 'ticket-3',
      title: 'Update the help page',
      actualStatus: 'todo',
      reportedStatus: 'todo',
      requiredWork: 5,
      completedWork: 0,
      reportedProgress: 0,
    },
    {
      id: 'ticket-4',
      title: 'Add form validation',
      actualStatus: 'todo',
      reportedStatus: 'todo',
      requiredWork: 12,
      completedWork: 0,
      reportedProgress: 0,
    },
    {
      id: 'ticket-5',
      title: 'Correct the page heading',
      actualStatus: 'todo',
      reportedStatus: 'todo',
      requiredWork: 3,
      completedWork: 0,
      reportedProgress: 0,
    },
    {
      id: 'ticket-6', title: 'Improve keyboard navigation',
      actualStatus: 'backlog', reportedStatus: 'backlog',
      requiredWork: 6, completedWork: 0, reportedProgress: 0,
    },
    {
      id: 'ticket-7', title: 'Review error messages',
      actualStatus: 'backlog', reportedStatus: 'backlog',
      requiredWork: 4, completedWork: 0, reportedProgress: 0,
    },
  ],
}
