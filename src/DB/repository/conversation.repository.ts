import { IConversation } from "../../common/interfaces";
import { ConversationModel } from "../models";
import { DatabaseRepository } from "./base.repository";

export class ConversationRepository extends DatabaseRepository<IConversation> {
  constructor() {
    super(ConversationModel);
  }
}

